// ---------------- Simple collection getters ----------------
import { rawLoad, rawSave, delay, KEY } from './core.js';
import { persistLoad } from '../persist.js';

const collGetter = (coll) => (opts = {}) => {
  const items = rawLoad()[coll] || [];
  return delay(opts.includeArchived ? items : items.filter((x) => !x.archived));
};
export const listEnquiries = collGetter('enquiries');
export const listVisits = collGetter('visits');
export const listDeals = collGetter('deals');
export const listLocalities = collGetter('localities');
export const listServices = collGetter('services');
export const listReviews = collGetter('reviews');
export const listReports = collGetter('reports');
export const listReferrals = collGetter('referrals');
export const listAnnouncements = collGetter('announcements');
export const listPlans = collGetter('plans');
export const listReels = collGetter('reels');
export const listNotifications = collGetter('notifications');
export const listMessages = collGetter('messages');
export const getFaqs = collGetter('faqs');
export const getBanners = collGetter('banners');

export function getLocality(slug) {
  const db = rawLoad();
  const loc = db.localities.find((l) => l.slug === slug) || null;
  const listings = loc ? db.listings.filter((l) => l.localitySlug === slug && l.status === 'approved') : [];
  return delay(loc ? { ...loc, listingsList: listings } : null);
}

export function getAnalytics() {
  const db = rawLoad();
  return delay(db.analytics);
}

export function getSettings() {
  return delay(rawLoad().settings);
}

export function updateSettings(patch) {
  const db = rawLoad();
  db.settings = { ...db.settings, ...patch };
  rawSave(db);
  // Notify in-tab listeners (storage event only fires cross-tab)
  window.dispatchEvent(new CustomEvent('punenest-settings-change'));
  return delay(db.settings);
}

/* Cross-context sync for admin-owned geo policy (dev).
   The persist layer treats the on-disk file as a store shared across browsers/profiles,
   but a browser that already has localStorage never re-reads it (see the hydration guard
   above) — so an admin toggling a city live in one browser never reaches a shopper in
   another. Pull the persisted `settings.geo` back in on demand so the navbar city roster
   and waitlist gate stay consistent everywhere. Best-effort + dev-only (persistLoad is a
   no-op in production and under Playwright), touches ONLY settings.geo (never per-browser
   user data), and writes localStorage directly to avoid a disk write-back loop. Resolves
   true only when something actually changed, after firing punenest-settings-change. */
export async function syncGeoFromDisk() {
  const disk = await persistLoad(KEY);
  if (!disk || !disk.settings || !disk.settings.geo) return false;
  const db = rawLoad();
  if (JSON.stringify(db.settings?.geo) === JSON.stringify(disk.settings.geo)) return false;
  db.settings = { ...db.settings, geo: disk.settings.geo };
  localStorage.setItem(KEY, JSON.stringify(db));
  window.dispatchEvent(new CustomEvent('punenest-settings-change'));
  return true;
}
