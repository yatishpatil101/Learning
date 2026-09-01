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
 *
 * **Two deliberate differences from the http provider, neither of them worth smoothing over.**
 *
 * *Scope.* The key is this browser's, suffixed with the signed-in mobile, so preferences are a fact
 * about one device; the server's are a fact about the account and follow the user to their phone.
 * That gap is not a defect in this file, it *is* the bug the port exists to close, and demo mode
 * cannot close it because it has no account to hang the document on.
 *
 * *Signed out.* `notifPrefKey()` falls back to `anon`, so this resolves for a caller with no
 * session; `GET /me/notification-preferences` is authenticated and answers that caller a 401.
 * Callers already treat a failed read as "nothing configured" (`ProfileTab` keeps its defaults,
 * `Notifications` errs towards showing alerts), so the divergence is confined to whether the read
 * resolves, not to what the screen then does — but a fabricated anonymous document would be a
 * silently different answer, so it is named here rather than mimicked there.
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
 *
 * **This one does not validate and the server does**, which is the third deliberate difference.
 * `language` must be one of `en`/`hi`/`mr` and each quiet-hours bound a 24-hour `HH:mm` — asserted
 * by `NotificationPreferencesUpdateRequest` as a 422 naming the field, and again by V73's CHECK
 * constraints. localStorage accepts whatever it is handed. Adding a copy of those rules here would
 * be a second place for them to drift, and the only controls that write these fields are a
 * three-option `Select` and two `TimeField`s that cannot emit anything else — so the practical
 * exposure is a caller inventing a value, which should fail on live rather than be talked out of it
 * in demo mode. The failure is loud where it matters and absent where nothing is at stake.
 */
export async function updateNotificationPreferences(next) {
  return setNotifPrefs(next);
}
