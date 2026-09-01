// ---------------- Simple collection getters ----------------
import { rawLoad, rawSave, delay } from './core.js';

const collGetter = (coll) => (opts = {}) => {
  const items = rawLoad()[coll] || [];
  return delay(opts.includeArchived ? items : items.filter((x) => !x.archived));
};
export const listEnquiries = collGetter('enquiries');
export const listVisits = collGetter('visits');
export const listDeals = collGetter('deals');
export const listLocalities = collGetter('localities');
export const listServices = collGetter('services');
// `listReviews` stood here. Its only caller was the admin Content console's Reviews tab, which now
// reads `GET /admin/reviews` through `reviewService.listReviewsForModeration`. The `db.reviews`
// list it read is still there and is still what the *mock* review provider serves that queue from
// — but through `rawDb()`, because the seam owns the shape now and the archived/active split this
// getter applied was a browser-store idea the server does not have.
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

/* `syncGeoFromDisk` used to be here.

   It pulled the persisted `settings.geo` back out of the on-disk store on window focus, so that an
   admin toggling a city live in one browser reached a shopper in another. It could not: its first
   line awaited `persistLoad(KEY)`, which returns `null` whenever `DISK_OFF` —
   `!import.meta.env.DEV || navigator.webdriver` — so it returned `false` before doing anything in
   every production build and under every Playwright run. The only place it ever worked was a
   second browser profile on a developer's own machine.

   The staleness it was covering for is closed properly now: geo policy is served by `GET /geo` and
   fetched once at boot into `lib/geoConfig.js`'s cache (register item 35). A cross-browser sync
   through a dev-only file store has nothing left to do. */
