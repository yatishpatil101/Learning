import { digits, myMobile } from '../contact.js';
import { get, set } from './internals.js';

/* =========================================================================
   Saved properties (heart/bookmark)
   ========================================================================= */
const savedPropsKey = () => 'pnSavedProps:' + (myMobile() || 'anon');
export const getSavedProps = () => get(savedPropsKey(), []);
export const isSavedProp = (id) => getSavedProps().includes(id);
export const toggleSavedProp = (id) => {
  const arr = getSavedProps();
  const idx = arr.indexOf(id);
  if (idx === -1) arr.push(id); else arr.splice(idx, 1);
  set(savedPropsKey(), arr);
  return idx === -1; // returns true if now saved
};

/* =========================================================================
   Notifications (in-app alerts) — one source of truth for the page + bell badge.
   Persisted per-user; seeded once so a revisit never duplicates entries.
   ========================================================================= */
const notifKey = () => 'pnNotifications:' + (myMobile() || 'anon');
// Read raw list (may include a leading seed marker filtered out by getNotifications).
const rawNotifs = () => get(notifKey(), null);
export const getNotifications = () => {
  const list = rawNotifs();
  return Array.isArray(list) ? list : [];
};
// Seed the default set exactly once. `defaults` is an array of notification objects
// (without `id`/`read`); we stamp a stable id + unread flag and store them. On every
// later call this is a no-op because the key already exists.
export const seedNotifsIfEmpty = (defaults = []) => {
  if (rawNotifs() != null) return getNotifications();
  const seeded = defaults.map((n, i) => ({
    id: n.id || `seed-${i}`,
    read: false,
    at: n.at != null ? n.at : Date.now() - i * 3600_000,
    ...n,
  }));
  set(notifKey(), seeded);
  return seeded;
};
export const unreadNotifCount = () => getNotifications().filter((n) => !n.read).length;
export const markAllNotifsRead = () => {
  const next = getNotifications().map((n) => (n.read ? n : { ...n, read: true }));
  set(notifKey(), next);
  return next;
};
export const markNotifRead = (id) => {
  const next = getNotifications().map((n) => (n.id === id && !n.read ? { ...n, read: true } : n));
  set(notifKey(), next);
  return next;
};
export const dismissNotif = (id) => {
  const next = getNotifications().filter((n) => n.id !== id);
  set(notifKey(), next);
  return next;
};
// Merge extra (real-data) notifications in, deduped by id, newest first.
export const mergeNotifs = (extra = []) => {
  if (!extra.length) return getNotifications();
  const cur = getNotifications();
  const seen = new Set(cur.map((n) => n.id));
  const add = extra.filter((n) => n.id && !seen.has(n.id)).map((n) => ({ read: false, at: Date.now(), ...n }));
  if (!add.length) return cur;
  const next = [...add, ...cur].sort((a, b) => (b.at || 0) - (a.at || 0));
  set(notifKey(), next);
  return next;
};

// Push a single notification into ANOTHER user's store (keyed by their mobile),
// deduped by id. Used for cross-user events — e.g. an owner granting document
// access notifies the buyer, whose notifications live under their own mobile,
// not the currently signed-in owner's. Newest-first; replaces any prior entry
// with the same id so repeat actions don't stack.
export const pushNotificationFor = (mobile, notif) => {
  const m = digits(mobile);
  if (!m || !notif || !notif.id) return;
  const key = 'pnNotifications:' + m;
  const cur = get(key, null);
  const list = Array.isArray(cur) ? cur.filter((n) => n.id !== notif.id) : [];
  const entry = { read: false, at: Date.now(), ...notif };
  set(key, [entry, ...list].sort((a, b) => (b.at || 0) - (a.at || 0)));
  return entry;
};

/* =========================================================================
   Notification & communication preferences (per user). Controls delivery
   channels, whether new-match alerts fire at all, quiet hours, and the
   language the platform uses for the user's updates. Honored by the
   Notifications page (match/price alert suppression) and surfaced in Settings.
   ========================================================================= */
const NOTIF_PREF_DEFAULTS = {
  email: true,
  sms: false,
  whatsapp: true,
  matchAlerts: true,
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
  language: 'en',
};
const notifPrefKey = () => 'pnNotifPrefs:' + (myMobile() || 'anon');
export const getNotifPrefs = () => {
  const saved = get(notifPrefKey(), {}) || {};
  return { ...NOTIF_PREF_DEFAULTS, ...saved, quietHours: { ...NOTIF_PREF_DEFAULTS.quietHours, ...(saved.quietHours || {}) } };
};
export const setNotifPrefs = (patch) => {
  const next = { ...getNotifPrefs(), ...patch };
  set(notifPrefKey(), next);
  return next;
};
// Whether "now" falls inside the user's quiet-hours window. Handles windows that
// wrap past midnight (e.g. 22:00 → 07:00). Non-critical alerts are muted while true.
export const inQuietHours = (prefs = getNotifPrefs(), at = new Date()) => {
  const q = prefs.quietHours;
  if (!q || !q.enabled) return false;
  const toMin = (s) => {
    const [h, m] = String(s || '').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const now = at.getHours() * 60 + at.getMinutes();
  const start = toMin(q.start);
  const end = toMin(q.end);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
};

