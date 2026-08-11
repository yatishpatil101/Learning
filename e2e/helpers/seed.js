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
 *
 * `addInitScript` runs on EVERY document — every `page.goto`, reload and
 * client-side hard navigation — not just the first one. Writing unconditionally
 * therefore resets the seeded keys back to the fixture on each navigation and
 * silently discards anything the app (or the spec) wrote into those same keys in
 * between. Specs that act on page A and then assert on page B were losing the
 * state they had just created.
 *
 * So each key is only written when it is currently absent. Effects:
 *  - first document: identical to the old behaviour (nothing is there yet);
 *  - later documents: the value the app persisted survives the navigation;
 *  - a key the app *deletes* (e.g. sign-out clearing `puneNestUser`) is absent
 *    again, so it is re-seeded exactly as before — sign-out semantics unchanged.
 * The check is `!== null` rather than a falsy test so a legitimately empty-string
 * value still counts as present.
 *
 * Pass `{ force: true }` to restore the old clobber-on-every-navigation
 * behaviour for a spec that genuinely wants the fixture re-applied.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, unknown>} entries key → value (objects are JSON-stringified).
 * @param {{ force?: boolean }} [opts]
 */
export async function seedStorage(page, entries, opts = {}) {
  await page.addInitScript(({ data, force }) => {
    for (const [k, v] of Object.entries(data)) {
      if (!force && localStorage.getItem(k) !== null) continue;
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }, { data: entries, force: Boolean(opts.force) });
}

/**
 * Seed a signed-in consumer user (buyer/owner/tenant) with optional extras.
 * @param {import('@playwright/test').Page} page
 * @param {object} user user record ({ name, mobile, role, ... }).
 * @param {{ aadhaar?: boolean, listings?: unknown[], savedSearches?: unknown[], force?: boolean }} [opts]
 */
export async function seedUser(page, user, opts = {}) {
  const entries = {
    [STORAGE_KEYS.user]: user,
    [STORAGE_KEYS.users]: [user],
  };
  if (opts.aadhaar) entries[STORAGE_KEYS.aadhaarFor(user.mobile)] = { verified: true, at: Date.now() };
  if (opts.listings) entries[STORAGE_KEYS.listingsFor(user.mobile)] = opts.listings;
  if (opts.savedSearches) entries[STORAGE_KEYS.savedSearchesFor(user.mobile)] = opts.savedSearches;
  await seedStorage(page, entries, { force: opts.force });
}
