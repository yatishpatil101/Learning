/**
 * Mock notification provider — the localStorage counterpart to `providers/http/notificationProvider.js`.
 *
 * Storage stays exactly where it was (`pnNotifications:<mobile>` in `lib/store/notifications.js`),
 * so the seeded demo inbox, the bell badge and the older prototype all keep working unchanged. What
 * this file adds is the *provider shape*: the same five operations the http provider exposes, with
 * the same argument order and the same return values.
 *
 * The seed is deliberately still owned by the page (`Notifications.jsx` passes `SEED` to
 * `seedNotifsIfEmpty`), because it is demo content rather than provider behaviour — the http
 * provider has no equivalent and must not grow one.
 */
import {
  dismissNotif,
  getNotifications,
  markAllNotifsRead,
  markNotifRead,
  mergeNotifs,
  unreadNotifCount,
} from '../../../lib/store.js';

/**
 * The whole inbox, newest first, with any client-derived rows merged in.
 *
 * `mergeNotifs` **persists** the extras here, which is right for the mock — localStorage is the
 * only store there is, so a merged row must survive a reload. The http provider deliberately does
 * not persist them; see the note there.
 */
export async function listNotifications(extra = []) {
  const list = extra.length ? mergeNotifs(extra) : getNotifications();
  return [...list].sort((a, b) => (b.at || 0) - (a.at || 0));
}

export async function unreadCount() {
  return unreadNotifCount();
}

export async function markRead(id) {
  markNotifRead(id);
}

export async function markAllRead() {
  markAllNotifsRead();
}

export async function dismiss(id) {
  dismissNotif(id);
}
