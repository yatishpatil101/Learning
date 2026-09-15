/* ADR-019: an owner who has never started a verification can post, so no badge is granted here.
   The second test holds a listing because the listing-limit paywall must not read as an identity wall. */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';

/* Baner is a real row in `GET /localities`, so the resolver files the listing rather than leaving
   `locality_slug` null and dropping it into the curation queue another spec asserts on. */
const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
  locality: 'Baner',
};

/* Listings this file put in the database. Rejected rather than deleted, because there is no delete
   and rejection is the state a shared live database needs them left in. */
const created = new Set();

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await fetch(`${API}/properties/${id}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup \u2014 synthetic no-gate fixture' }),
    });
  }
  created.clear();
});

// Sign the owner in WITHOUT any identity badge — they must still reach the form.
async function gotoOwner(page, { withListing = false } = {}) {
  const mobile = await signedInAsNew(page);
  if (withListing) {
    const res = await fetch(`${API}/me/listings`, {
      method: 'POST',
      headers: await authHeaders(mobile),
      body: JSON.stringify({ ...BASE_LISTING, title: `Zztest no-gate ${Date.now()}` }),
    });
    expect(res.status).toBe(201);
    created.add((await res.json()).id);
  }
  await page.goto('/list-property');
  return mobile;
}

// The Details/Location/Photos form is present iff the property-type selector is.
const formLocator = (page) => page.locator('[data-err="propertyType"]');
// The removed gate heading — must never appear now.
const gateHeading = (page) => page.getByRole('heading', { name: 'Verify your identity to start' });

test('a signed-in owner reaches the wizard form immediately — no identity gate', async ({ page }) => {
  await gotoOwner(page);

  // The momentum meter and the Step 1 property-type form are shown straight away …
  await expect(page.locator('.lp-meter')).toBeVisible();
  await expect(formLocator(page)).toBeVisible({ timeout: 20000 });
  // … and the old identity wall is gone for an unverified owner.
  await expect(gateHeading(page)).toHaveCount(0);
});

test('an existing listing never triggers an identity gate (limit paywall is not KYC)', async ({ page }) => {
  await gotoOwner(page, { withListing: true });
  // Whatever shows (form or the listing-limit paywall), it is NEVER an identity wall.
  await expect(page.locator('.lp-meter')).toBeVisible({ timeout: 20000 });
  await expect(gateHeading(page)).toHaveCount(0);
  await expect(page.getByText('Is this the mobile number linked to your identity document?')).toHaveCount(0);
});

test('the form survives a reload — an unverified owner is never re-gated', async ({ page }) => {
  await gotoOwner(page);
  await expect(formLocator(page)).toBeVisible({ timeout: 20000 });

  await page.reload();
  await expect(formLocator(page)).toBeVisible({ timeout: 20000 });
  await expect(gateHeading(page)).toHaveCount(0);
});
