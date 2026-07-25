import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const MOBILE = '9876543210';

// Sign the owner in WITHOUT seeding Aadhaar verification, so the gate is the
// first thing they hit. Optionally seed an existing listing to prove that having
// listings no longer bypasses the identity check.
async function gotoUnverified(page, { withListing = false, mobile = MOBILE } = {}) {
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
  await page.getByRole('heading', { name: 'Verify your identity to start' }).waitFor({ timeout: 10000 });
}

const pctOf = async (page) => {
  const raw = await page.locator('.lp-meter__pct').innerText();
  return parseInt(raw.replace(/\D/g, ''), 10);
};

// The Details/Location/Photos form is present iff the property-type selector is.
const formLocator = (page) => page.locator('[data-err="propertyType"]');

test('the momentum meter is shown during verification, with the tabs/form hidden', async ({ page }) => {
  await gotoUnverified(page);

  // The shared meter is present (same "upper part" as the posting flow) …
  await expect(page.locator('.lp-meter')).toBeVisible();
  await expect(page.getByText('Verify your identity', { exact: true })).toBeVisible();
  // … and shows only Aadhaar's share of progress so far (≤ 20%).
  expect(await pctOf(page)).toBeLessThanOrEqual(20);

  // The gate is shown …
  await expect(page.getByRole('heading', { name: 'Verify your identity to start' })).toBeVisible();
  await expect(page.getByText('Is this the mobile number linked to your Aadhaar?')).toBeVisible();
  // … but the Details/Location/Photos form is hidden until identity is verified.
  await expect(formLocator(page)).toHaveCount(0);
});

test('an existing listing does NOT bypass the Aadhaar gate', async ({ page }) => {
  await gotoUnverified(page, { withListing: true });
  // Even with a prior listing, verification is still required before posting.
  await expect(page.getByRole('heading', { name: 'Verify your identity to start' })).toBeVisible();
  await expect(formLocator(page)).toHaveCount(0);
});

test('denying the pre-filled number routes to sign in with the Aadhaar mobile', async ({ page }) => {
  await gotoUnverified(page);
  await page.getByRole('button', { name: /a different number/i }).click();
  const panel = page.locator('.glass-card', { hasText: 'Sign in with your Aadhaar-linked number' });
  await expect(page.getByRole('heading', { name: 'Sign in with your Aadhaar-linked number' })).toBeVisible();
  // The signed-in number is echoed so the owner knows which account to leave.
  await expect(panel.getByText('+91 98765 43210')).toBeVisible();
  // Back returns to the confirmation step.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText('Is this the mobile number linked to your Aadhaar?')).toBeVisible();
});

test('verifying keeps the same meter and reveals the tabs/form (reaching 20%)', async ({ page }) => {
  await gotoUnverified(page);

  // Confirm the pre-filled Aadhaar-linked number → OTP is sent.
  await page.getByRole('button', { name: /Send OTP/i }).click();

  // Fill the 6-digit OTP (the mock accepts any 6 digits) and continue.
  await page.getByLabel('OTP digit 1').waitFor({ timeout: 5000 });
  for (let i = 0; i < 6; i++) {
    await page.getByLabel(`OTP digit ${i + 1}`).fill(String((i + 1) % 10));
  }
  await page.getByRole('button', { name: /Verify & Continue/i }).click();

  // The same meter stays put (no theme switch); the verified banner + form appear.
  await expect(page.getByText(/Aadhaar verified/)).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.lp-meter')).toBeVisible();
  await expect(formLocator(page)).toBeVisible();
  // Aadhaar is worth 20%, so a just-verified owner is at least 20% complete.
  expect(await pctOf(page)).toBeGreaterThanOrEqual(20);
});

test('verification persists across reloads (no re-gating a verified owner)', async ({ page }) => {
  await gotoUnverified(page);
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await page.getByLabel('OTP digit 1').waitFor({ timeout: 5000 });
  for (let i = 0; i < 6; i++) {
    await page.getByLabel(`OTP digit ${i + 1}`).fill('1');
  }
  await page.getByRole('button', { name: /Verify & Continue/i }).click();
  await expect(formLocator(page)).toBeVisible({ timeout: 10000 });

  // Reload — a verified owner goes straight to the form, no gate.
  await page.reload();
  await page.waitForSelector('[data-err="propertyType"]', { timeout: 10000 });
  await expect(page.getByRole('heading', { name: 'Verify your identity to start' })).toHaveCount(0);
});
