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

// Matches the server's per-call cap on POST /notifications/dismiss.
const DISMISS_BATCH = 100;

export async function dismiss(id) {
  const ids = (Array.isArray(id) ? id : [id]).filter(Boolean);
  if (ids.length === 1) {
    await del(`/notifications/${ids[0]}`);
    return;
  }
  for (let i = 0; i < ids.length; i += DISMISS_BATCH) {
    await post('/notifications/dismiss', { ids: ids.slice(i, i + DISMISS_BATCH) });
  }
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
