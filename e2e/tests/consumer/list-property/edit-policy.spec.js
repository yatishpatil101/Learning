/**
 * The edit-policy banner and the free-plan paywall, driven by real listings.
 *
 * Nothing here is seeded into the browser. The listing is posted through `POST /me/listings` and
 * the ceiling comes from `GET /me/entitlements`, so the paywall test cannot agree with itself by
 * construction. The two tier tests turn on `editApproved`, which `useListProperty.js:155` derives
 * from the *status of the fetched listing*, moderated to `approved` by an admin here — so an edit
 * flow that stopped reading the server's status fails.
 *
 * Each test mints its own owner. That is not tidiness: the free tier allows exactly one listing, so
 * a shared account would make the paywall test depend on the order the others ran in.
 *
 * Listings are rejected in `afterEach` rather than deleted, because there is no delete — a rejected
 * listing leaves the verification queue and the public site, which is the state a shared database
 * needs it in.
 */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';

const created = new Set();

const BASE_LISTING = {
  deal: 'buy',
  propertyType: 'Flat',
  price: 5000000,
  city: 'Pune',
  bhk: 2,
  area: 900,
  // A real entry in `GET /localities`, so the resolver files the listing rather than leaving
  // `locality_slug` null and dropping it into the curation queue `live-locality-queue` owns.
  locality: 'Baner',
  /* Price now sits a step past the address, so an edit has to cross the address step to reach it.
     A listing with no address at all is a shape the wizard cannot produce, and demanding one back
     from this fixture would be testing address validation instead of edit policy. Coordinates are
     still deliberately absent: `LocalityResolver` treats a null pin as a listing awaiting curation,
     so this is also the one fixture that proves the map gate does not strand such an owner. */
  address: 'D-704, Zztest Policy Heights, Baner Road',
  pincode: '411045',
  formDetails: { flatNumber: 'D-704', society: 'Zztest Policy Heights', street: 'Baner Road' },
};

const formLocator = (page) => page.locator('[data-err="propertyType"]');

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

/**
 * A signed-in owner who already has one approved listing.
 *
 * Approval is a separate call because a new listing lands in moderation, and `editApproved` — the
 * flag that decides which of the two banners renders — is read off that status. Posting alone would
 * have exercised the wrong branch.
 */
async function ownerWithLiveListing(page, overrides) {
  const mobile = await signedInAsNew(page);
  const res = await api('POST', '/me/listings', await authHeaders(mobile), {
    ...BASE_LISTING,
    title: `Zztest edit-policy ${Date.now()}`,
    ...overrides,
  });
  expect(res.status).toBe(201);
  created.add(res.body.id);

  const approved = await api('PATCH', `/properties/${res.body.id}/status`, await authHeaders(ACTORS.admin), {
    status: 'approved',
  });
  expect(approved.status).toBe(200);
  return { mobile, id: res.body.id };
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic edit-policy fixture',
    });
  }
  created.clear();
});

test('a first free listing is NOT paywalled and shows no edit banner', async ({ page }) => {
  await signedInAsNew(page); // a brand-new owner, so no existing listings
  await page.goto('/list-property');
  await expect(formLocator(page)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/used your free listing/i)).toHaveCount(0);
  await expect(page.getByText(/editing a live listing/i)).toHaveCount(0);
});

test('P2 — a second new listing is paywalled on the free plan', async ({ page }) => {
  await ownerWithLiveListing(page);
  await page.goto('/list-property');
  // The paywall replaces the form once the free quota is used.
  await expect(page.getByRole('heading', { name: /used your free listing/i })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('link', { name: /Upgrade & post/i })).toBeVisible();
  await expect(formLocator(page)).toHaveCount(0);
});

test('P1 — editing a live listing shows the tiered edit banner (and no paywall)', async ({ page }) => {
  const { id } = await ownerWithLiveListing(page);
  await page.goto(`/list-property?edit=${id}`);

  // The edit-policy banner explains the two tiers …
  await expect(page.getByRole('heading', { name: /editing a live listing/i })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Publishes instantly')).toBeVisible();
  await expect(page.getByText('Needs a re-check')).toBeVisible();

  // … editing an existing listing is never paywalled, and the form is available.
  await expect(page.getByText(/used your free listing/i)).toHaveCount(0);
  await expect(formLocator(page)).toBeVisible();
});

test('P1 — a Tier-A edit surfaces the re-check summary + status timeline', async ({ page }) => {
  const { id } = await ownerWithLiveListing(page);
  await page.goto(`/list-property?edit=${id}`);
  await expect(page.getByRole('heading', { name: /editing a live listing/i })).toBeVisible({ timeout: 20000 });

  // Change BHK from 2 → 3 on step 1. BHK is one of the four fields that set
  // `remoderationRequired` in ListingEditRules.apply, so the server takes the listing down.
  await page.locator('[data-err="bhk"]').getByText('3', { exact: true }).click();

  // The live summary flags a re-check …
  await expect(page.getByText(/need a re-check/i)).toBeVisible({ timeout: 15000 });

  // … and, because this is a field buyers search on, says so: the listing comes OFF
  // SEARCH rather than staying live. The plain "Update under review" chip is not enough to
  // assert on — it renders for both outcomes, so it cannot tell the owner-visible difference
  // between an edit that keeps the listing earning and one that takes it down.
  await expect(page.getByText(/comes off search while we re-check it/i)).toBeVisible();
  await expect(page.getByText('Under review — off search')).toBeVisible();
});

test('P1 — a price edit is re-checked but the banner promises the listing stays live', async ({ page }) => {
  const { id } = await ownerWithLiveListing(page);
  await page.goto(`/list-property?edit=${id}`);
  await expect(page.getByRole('heading', { name: /editing a live listing/i })).toBeVisible({ timeout: 20000 });

  // Price sets `recheckOnly` rather than `remoderationRequired` in ListingEditRules.apply (Q14): a
  // cheaper 2 BHK is still the same 2 BHK, so the listing keeps earning while staff confirm the
  // number. This test is the complement of the one above and the pair is the point — one banner
  // for both outcomes is a broken promise in one direction and a deterrent against honest price
  // cuts in the other.
  //
  // Price lives on the third step; the banner renders above the wizard on every step, so advancing
  // does not change what is being asserted. The details and address are already valid from the
  // loaded listing.
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.getByRole('heading', { name: 'Price & terms', exact: true })).toBeVisible({ timeout: 20000 });
  const price = page.locator('input[data-err="price"]');
  await expect(price).toBeVisible({ timeout: 20000 });
  await price.fill('4500000');
  await price.blur();

  // Still a re-check — a price edit is not free …
  await expect(page.getByText(/need a re-check/i)).toBeVisible({ timeout: 15000 });

  // … but the owner is told the listing keeps working, and the off-search copy must NOT appear.
  await expect(page.getByText(/stays live and searchable while we re-check/i)).toBeVisible();
  await expect(page.getByText('Live — being re-checked')).toBeVisible();
  await expect(page.getByText(/comes off search while we re-check it/i)).toHaveCount(0);
  await expect(page.getByText('Under review — off search')).toHaveCount(0);
});

test('P1 — re-zoning a plot is warned about, even though nobody types the field it changes', async ({ page }) => {
  /* The zone is the only foundation edit the owner cannot see the name of. `landUse` is what the
     server takes a listing off search for, but no form asks for it — `submit.js` derives it from
     `landUseFor(propertyType, plotZone)`. `propertyType` was already a warned field; `plotZone` was
     in neither tier, so `classifyChanges` could not report a re-zone at all and the owner lost their
     search placement in silence. Asserting through the zone picker rather than through the tier list
     is the point: the mapping from the answer to the column is what broke, and only the UI crosses it. */
  const { id } = await ownerWithLiveListing(page, {
    propertyType: 'Open Plot',
    area: 12,
    areaUnit: 'guntha',
    landUse: 'residential',
    bhk: undefined,
    formDetails: { plotZone: 'Residential (R1)' },
  });
  await page.goto(`/list-property?edit=${id}`);
  await expect(page.getByRole('heading', { name: /editing a live listing/i })).toBeVisible({ timeout: 20000 });
  /* Before the edit, so this cannot pass on a prefill that already differs from the stored row —
     which is the way a test of a *newly* classified field fails silently rather than red. */
  await expect(page.getByText('Under review — off search')).toHaveCount(0);

  // R1 → C-1 moves `landUse` residential → commercial, which is a different Land-use filter.
  await page.getByText('Residential (R1)', { exact: true }).click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: 'Commercial (C-1)' }).first().click();

  await expect(page.getByText(/need a re-check/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/comes off search while we re-check it/i)).toBeVisible();
  await expect(page.getByText('Under review — off search')).toBeVisible();
});
