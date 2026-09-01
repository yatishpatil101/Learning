/**
 * Mock notification provider — the localStorage counterpart to `providers/http/notificationProvider.js`.
 *
 * Storage stays exactly where it was (`pnNotifications:<mobile>` in `lib/store/notifications.js`),
 * so the seeded demo inbox, the bell badge and the older prototype all keep working unchanged. What
 * this file adds is the *provider shape*: the same five operations the http provider exposes, with
 * the same argument order and the same return values.
 *
 * **The demo seed lives here, and only here.** It used to be owned by `Notifications.jsx`, which
 * held the eight rows and called `seedNotifsIfEmpty` behind an `isHttpDomain('notification')`
 * check. That check was correct and never fired wrongly, but it made a page in product code carry
 * a mock-store import and a build-time env read whose only job was to switch itself off. Moving
 * the seed into this file turns that gate from a condition into a fact: the http provider is a
 * different module, does not import the store, and so cannot write a fabricated row into a real
 * inbox no matter what any page does.
 */
import {
  dismissNotif,
  getNotifPrefs,
  getNotifications,
  markAllNotifsRead,
  markNotifRead,
  mergeNotifs,
  seedNotifsIfEmpty,
  setNotifPrefs,
  unreadNotifCount,
} from '../../../lib/store.js';

const H = 3600_000;
const D = 24 * H;

/**
 * The demo inbox.
 *
 * Written once per user (`seedNotifsIfEmpty` no-ops as soon as the key exists), so a revisit never
 * duplicates a row. `at` drives ordering and the Today/Earlier split, and the human time label is
 * derived from it, so there is a single source of truth. The ids are stable because
 * `Notifications.jsx` localises known rows by `notifications.seed.<id>` — the English below is the
 * fallback, not the only copy — and because `live-property-integration` asserts by id that none of
 * these ever reach a live build.
 */
const now = Date.now();
const SEED = [
  { id: 'n-match-baner', type: 'match', read: false, at: now - 10 * 60_000, title: '3 new properties match your search', desc: 'New 3 BHK flats listed in Baner under ₹1.3 Cr.', link: '/listings?type=buy&q=baner' },
  { id: 'n-flatmate-hinjawadi', type: 'share', read: false, at: now - 1 * H, title: 'A flatmate match near Hinjawadi', desc: 'A verified working professional is looking for a flatmate for a 2 BHK in Hinjawadi.', link: '/listings?type=flatmate&q=hinjawadi' },
  { id: 'n-enquiry-priya', type: 'enquiry', read: false, at: now - 2 * H, title: 'Priya Kulkarni sent an enquiry', desc: '"Is the 3 BHK in Baner still available for a weekend visit?"', link: '/dashboard#enquiries' },
  { id: 'n-price-kp', type: 'price', read: false, at: now - 5 * H, title: 'Price dropped on a saved property', desc: '4 BHK Villa, Koregaon Park reduced by ₹15 Lakh.', link: '/saved' },
  { id: 'n-visit-wakad', type: 'visit', read: true, at: now - 1 * D, title: 'Visit confirmed for Saturday', desc: 'Site visit at 11:00 AM for 2 BHK Flat, Wakad.', link: '/schedule-visit' },
  { id: 'n-match-balewadi', type: 'match', read: true, at: now - 2 * D, title: 'New project launched near you', desc: 'Skyline Heights, Balewadi — pre-launch prices from ₹68 L.', link: '/listings' },
  { id: 'n-enquiry-viewed', type: 'enquiry', read: true, at: now - 3 * D, title: 'Your enquiry was viewed', desc: 'The owner of 3 BHK Flat, Baner viewed your enquiry.', link: '/dashboard#enquiries' },
  { id: 'n-system-welcome', type: 'system', read: true, at: now - 5 * D, title: 'Welcome to PuneNest!', desc: 'Complete your profile to get personalised recommendations.', link: '/dashboard#profile' },
];

/**
 * The whole inbox, newest first, with any client-derived rows merged in.
 *
 * Seeds on the way in, which is where the page used to do it — the first read a demo build performs
 * is still the read that fills the inbox. Seeding here rather than on module load also keeps the
 * rows keyed to whoever is signed in, since `seedNotifsIfEmpty` writes `pnNotifications:<mobile>`.
 *
 * `mergeNotifs` **persists** the extras here, which is right for the mock — localStorage is the
 * only store there is, so a merged row must survive a reload. The http provider deliberately does
 * not persist them; see the note there.
 */
export async function listNotifications(extra = []) {
  seedNotifsIfEmpty(SEED);
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
