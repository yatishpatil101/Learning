/**
 * Badge-not-gate (ADR-019), against an account the server genuinely has not verified.
 *
 * Converted from `no-gate.spec.js`. The mock version had a hole worth naming: it seeded
 * `puneNestAadhaar:<mobile>` — a *verified* Aadhaar record — and then asserted that the identity
 * wall was absent. It was checking that a verified owner sees no gate, which is not the claim.
 * ADR-019 says an owner who has never touched DigiLocker can post. Here the account is registered
 * over HTTP seconds earlier and no badge is granted, so `GET /me` really does report an unverified
 * user and the wizard really does have to let them in. If a gate ever comes back, this fails.
 *
 * The reload test is likewise no longer staged. The mock reloaded a page whose localStorage it had
 * written itself; this one reloads against a real session and a real verification lookup, so
 * "never re-gated" now means the second render of the app, with fresh server state, still admits
 * an unverified owner.
 *
 * The second test needs the owner to already hold a listing, because the claim is that the
 * listing-limit paywall — which a free account hits at its second listing — is not an identity wall
 * wearing a different hat. The listing is created through `POST /me/listings` rather than driven
 * through the wizard: the subject here is what the *second* visit renders, and posting the first one
 * through the UI would be a slower way to reach the same precondition. `live-listing-quota` owns the
 * claim that the ceiling is one.
 */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';

/* Baner is a real row in `GET /localities`, so the resolver files the listing instead of leaving
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

/* Listings this file put in the database. Rejected afterwards rather than deleted, because there is
   no delete: a rejected listing leaves the verification queue and the public site, which is the
   state a shared live database needs it left in. */
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

// Sign the owner in WITHOUT any Aadhaar/badge — they must still reach the form.
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

test('a signed-in owner reaches the wizard form immediately — no Aadhaar gate', async ({ page }) => {
  await gotoOwner(page);

  // The momentum meter and the Step 1 property-type form are shown straight away …
  await expect(page.locator('.lp-meter')).toBeVisible();
  await expect(formLocator(page)).toBeVisible({ timeout: 20000 });
  // … and the old identity wall is gone for an unverified owner.
  await expect(gateHeading(page)).toHaveCount(0);
  await expect(page.getByText('Is this the mobile number linked to your Aadhaar?')).toHaveCount(0);
});

test('an existing listing never triggers an identity gate (limit paywall is not KYC)', async ({ page }) => {
  await gotoOwner(page, { withListing: true });
  // Whatever shows (form or the listing-limit paywall), it is NEVER an Aadhaar wall.
  await expect(page.locator('.lp-meter')).toBeVisible({ timeout: 20000 });
  await expect(gateHeading(page)).toHaveCount(0);
  await expect(page.getByText('Is this the mobile number linked to your Aadhaar?')).toHaveCount(0);
});

test('the form survives a reload — an unverified owner is never re-gated', async ({ page }) => {
  await gotoOwner(page);
  await expect(formLocator(page)).toBeVisible({ timeout: 20000 });

  await page.reload();
  await expect(formLocator(page)).toBeVisible({ timeout: 20000 });
  await expect(gateHeading(page)).toHaveCount(0);
});
