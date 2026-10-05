self.addEventListener('push', (event) => {
  const payload = event.data?.json?.() || {};
  const title = payload.title || 'Draazy';
  const body = payload.body || 'You have a new message';
  const url = safeUrl(payload.url);
  event.waitUntil(self.registration.showNotification(title, { body, data: { url } }));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data?.url);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = new URL(url, self.location.origin).href;
    const open = all.find((client) => client.url.startsWith(self.location.origin));
    if (open) {
      await open.focus();
      try {
        return await open.navigate(target);
      } catch {
        return self.clients.openWindow(target);
      }
    }
    return self.clients.openWindow(target);
  })());
});

function safeUrl(value) {
  try {
    const url = new URL(value || '/messages', self.location.origin);
    return url.origin === self.location.origin ? `${url.pathname}${url.search}${url.hash}` : '/messages';
  } catch {
    return '/messages';
  }
}
