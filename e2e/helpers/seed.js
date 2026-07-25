// localStorage seeding helpers for the mock backend.
//
// The app persists everything under `puneNest*` / `pn*` localStorage keys (see
// frontend mock service layer). These helpers set that state *before* the app
// boots via `addInitScript`, so a spec starts from a known fixture.

export const STORAGE_KEYS = {
  user: 'puneNestUser',        // current logged-in user
  users: 'puneNestUsers',      // registered users array
  db: 'puneNestDB_v5',         // main mock DB (see frontend/src/lib/mockApi/core.js KEY)
  listingsFor: (mobile) => `puneNestListings:${mobile}`,
  aadhaarFor: (mobile) => `puneNestAadhaar:${mobile}`,
  savedSearchesFor: (mobile) => `pnSavedSearches:${mobile}`,
  recentSearchesFor: (mobile) => `pnRecentSearches:${mobile}`,
};

/** Canonical demo users by role. Override any field via the spread argument. */
export const USERS = {
  buyer: { name: 'Test Buyer', mobile: '9876500001', role: 'buyer', loginAt: Date.now() },
  owner: { name: 'Test Owner', mobile: '9876500002', role: 'owner', loginAt: Date.now() },
  tenant: { name: 'Test Tenant', mobile: '9876500003', role: 'tenant', loginAt: Date.now() },
};

/**
 * Seed arbitrary localStorage entries before the app loads.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, unknown>} entries key → value (objects are JSON-stringified).
 */
export async function seedStorage(page, entries) {
  await page.addInitScript((data) => {
    for (const [k, v] of Object.entries(data)) {
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }, entries);
}

/**
 * Seed a signed-in consumer user (buyer/owner/tenant) with optional extras.
 * @param {import('@playwright/test').Page} page
 * @param {object} user user record ({ name, mobile, role, ... }).
 * @param {{ aadhaar?: boolean, listings?: unknown[], savedSearches?: unknown[] }} [opts]
 */
export async function seedUser(page, user, opts = {}) {
  const entries = {
    [STORAGE_KEYS.user]: user,
    [STORAGE_KEYS.users]: [user],
  };
  if (opts.aadhaar) entries[STORAGE_KEYS.aadhaarFor(user.mobile)] = { verified: true, at: Date.now() };
  if (opts.listings) entries[STORAGE_KEYS.listingsFor(user.mobile)] = opts.listings;
  if (opts.savedSearches) entries[STORAGE_KEYS.savedSearchesFor(user.mobile)] = opts.savedSearches;
  await seedStorage(page, entries);
}
