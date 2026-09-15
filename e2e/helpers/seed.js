// Browser session and per-user UI state (`draazy*` / `pn*` keys) that the live app reads on boot;
// seeding via `addInitScript` lets a spec start signed in without driving the OTP flow.

export const STORAGE_KEYS = {
  user: 'draazyUser',        // current logged-in user
  listingsFor: (mobile) => `draazyListings:${mobile}`,
  identityFor: (mobile) => `draazyIdentity:${mobile}`,
  savedSearchesFor: (mobile) => `dzSavedSearches:${mobile}`,
  recentSearchesFor: (mobile) => `dzRecentSearches:${mobile}`,
};

/** Canonical demo users by role. Override any field via the spread argument. */
export const USERS = {
  buyer: { name: 'Test Buyer', mobile: '9876500001', role: 'buyer', loginAt: Date.now() },
  owner: { name: 'Test Owner', mobile: '9876500002', role: 'owner', loginAt: Date.now() },
  tenant: { name: 'Test Tenant', mobile: '9876500003', role: 'tenant', loginAt: Date.now() },
};

/* `addInitScript` runs on every document, so keys are written only when absent — otherwise each
 * navigation would clobber what the app or the spec persisted. `{ force: true }` opts back in. */
export async function seedStorage(page, entries, opts = {}) {
  await page.addInitScript(({ data, force }) => {
    for (const [k, v] of Object.entries(data)) {
      if (!force && localStorage.getItem(k) !== null) continue;
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }, { data: entries, force: Boolean(opts.force) });
}

/** Seed a signed-in consumer user (buyer/owner/tenant) with optional extras. */
export async function seedUser(page, user, opts = {}) {
  const entries = {
    [STORAGE_KEYS.user]: user,
  };
  if (opts.identityVerified) entries[STORAGE_KEYS.identityFor(user.mobile)] = { verified: true, at: Date.now() };
  if (opts.listings) entries[STORAGE_KEYS.listingsFor(user.mobile)] = opts.listings;
  if (opts.savedSearches) entries[STORAGE_KEYS.savedSearchesFor(user.mobile)] = opts.savedSearches;
  await seedStorage(page, entries, { force: opts.force });
}
