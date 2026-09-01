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
  getNotifPrefs,
  getNotifications,
  markAllNotifsRead,
  markNotifRead,
  mergeNotifs,
  setNotifPrefs,
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

/**
 * The caller's delivery preferences.
 *
 * Reads `lib/store/notifications.js` unchanged — same key (`pnNotifPrefs:<mobile>`), same defaults,
 * same merge over them. Demo mode behaves exactly as it did before this pair existed, which is the
 * whole point of routing it through the provider rather than letting the page keep calling the
 * store directly: the http provider now has somewhere to be.
 */
export async function getNotificationPreferences() {
  return getNotifPrefs();
}

/**
 * Write the whole preferences document.
 *
 * **Takes a complete document, not a patch**, matching the http provider, which has no choice —
 * `PUT /me/notification-preferences` requires all six fields and 422s on a missing one. The merging
 * therefore happens in `notificationService.js`, above both providers, so the two cannot disagree
 * about what "unchanged" means. `setNotifPrefs` still merges internally, which is harmless when it
 * is handed the full object.
 */
export async function updateNotificationPreferences(next) {
  return setNotifPrefs(next);
}
