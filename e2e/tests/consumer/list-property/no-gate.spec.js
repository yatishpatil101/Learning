import { test, expect } from '@playwright/test';

/* Badge-not-gate (ADR-019): posting a property needs only a signed-in (L1
   mobile-verified) account. The old "Verify your identity to start" Aadhaar wall
   is gone — the wizard form is available immediately, verified or not. Identity
   verification is now an opt-in Verified badge, never a wall to posting. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543210';

// Sign the owner in WITHOUT any Aadhaar/badge — they must still reach the form.
async function gotoOwner(page, { withListing = false, mobile = MOBILE } = {}) {
  await page.addInitScript(({ mobile, withListing }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now(),
    }));
    if (withListing) {
      localStorage.setItem('puneNestListings:' + mobile, JSON.stringify([
        { id: 'L1', title: 'Existing Flat', status: 'approved' },
      ]));
    }
  }, { mobile, withListing });
  await page.goto(`${BASE}/list-property`);
}

// The Details/Location/Photos form is present iff the property-type selector is.
const formLocator = (page) => page.locator('[data-err="propertyType"]');
// The removed gate heading — must never appear now.
const gateHeading = (page) => page.getByRole('heading', { name: 'Verify your identity to start' });

test('a signed-in owner reaches the wizard form immediately — no Aadhaar gate', async ({ page }) => {
  await gotoOwner(page);

  // The momentum meter and the Step 1 property-type form are shown straight away …
  await expect(page.locator('.lp-meter')).toBeVisible();
  await expect(formLocator(page)).toBeVisible({ timeout: 10000 });
  // … and the old identity wall is gone for an unverified owner.
  await expect(gateHeading(page)).toHaveCount(0);
  await expect(page.getByText('Is this the mobile number linked to your Aadhaar?')).toHaveCount(0);
});

test('an existing listing never triggers an identity gate (limit paywall is not KYC)', async ({ page }) => {
  await gotoOwner(page, { withListing: true });
  // Whatever shows (form or the listing-limit paywall), it is NEVER an Aadhaar wall.
  await expect(page.locator('.lp-meter')).toBeVisible({ timeout: 10000 });
  await expect(gateHeading(page)).toHaveCount(0);
  await expect(page.getByText('Is this the mobile number linked to your Aadhaar?')).toHaveCount(0);
});

test('the form survives a reload — an unverified owner is never re-gated', async ({ page }) => {
  await gotoOwner(page);
  await expect(formLocator(page)).toBeVisible({ timeout: 10000 });

  await page.reload();
  await expect(formLocator(page)).toBeVisible({ timeout: 10000 });
  await expect(gateHeading(page)).toHaveCount(0);
});
