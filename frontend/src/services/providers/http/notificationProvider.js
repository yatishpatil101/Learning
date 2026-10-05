/** The one behaviour with no endpoint — client-derived alerts, which have no server row — is handled here rather than
 * being dropped or thrown, and is confined to this file so the page cannot tell. */
import { del, get, post, put } from '../../http.js';
import { toViewModelList } from './notificationMapper.js';

const DEFAULT_PAGE_SIZE = 50;

function pageMeta(payload, requested) {
  const items = toViewModelList(payload).sort((a, b) => (b.at || 0) - (a.at || 0));
  return {
    items,
    page: payload?.page ?? payload?.number ?? requested.page,
    size: payload?.size ?? requested.size,
    total: payload?.totalElements ?? items.length,
    totalPages: payload?.totalPages ?? 0,
  };
}

export async function listNotifications({ page = 0, size = DEFAULT_PAGE_SIZE } = {}) {
  const requested = { page, size };
  return pageMeta(await get('/notifications', requested), requested);
}

/** There is no count endpoint, so this reads the same large page and counts it — accurate up to the ceiling, and
 * audibly wrong beyond it rather than silently. Deliberately excludes dismissed rows. */
export async function unreadCount() {
  const body = await get('/notifications/unread-count');
  return Number(body?.count ?? 0);
}

export async function markRead(id) {
  if (!id) return;
  const ids = Array.isArray(id) ? id.filter(Boolean) : [id];
  if (!ids.length) return;
  await post('/notifications/read', { ids });
}

export async function markAllRead() {
  await post('/notifications/read', {});
}

export async function dismiss(id) {
  if (!id) return;
  await del(`/notifications/${id}`);
}

export async function getNotificationPreferences() {
  return get('/me/notification-preferences');
}

/** **Every field is required and the caller must send all six.** That is not an oversight in the contract, it is the
 * contract. */
export async function updateNotificationPreferences(next) {
  return put('/me/notification-preferences', next);
}

export async function registerPushSubscription(subscription) {
  await post('/me/push-subscriptions', subscription);
}

export async function unregisterPushSubscription(endpoint) {
  if (!endpoint) return;
  await del('/me/push-subscriptions', { query: { endpoint } });
}
