import { test, expect } from '@playwright/test';

/* The optional "Verified Seeker" badge (flatmates) is earned from the Hero's "Get verified" CTA and
   is never a gate to posting (see flatmates-no-gate.spec.js). What this spec owns is the **entry
   point**: that the flatmates page opens the platform verification modal for an unverified seeker.
 *
 * It used to drive the whole flow — a "Become a verified seeker" modal that confirmed the
 * signed-in number, sent an Aadhaar OTP, and offered "No, it's a different number" as a route back
 * to sign-in. That flow no longer exists: verification moved to DigiLocker, where the Aadhaar
 * number and OTP are entered on DigiLocker's own page and never on PuneNest, so there is no number
 * to confirm and no OTP box to fill. Those steps were not renamed, they were removed.
 *
 * The replacement flow (modal → DigiLocker → badge earned) is already driven end to end by
 * `platform/auth/kyc-growth-levers.spec.js`. Re-asserting it here would duplicate that coverage
 * without adding anything; asserting the flatmates-specific entry point does not. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9812340000';

async function seedUnverified(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    // No seeker-verified key → not yet a Verified Seeker.
  }, mobile);
}

test('the flatmates "Get verified" CTA opens the platform verification modal', async ({ page }) => {
  await seedUnverified(page);
  await page.goto(`${BASE}/flatmates`);

  await page.getByRole('button', { name: /Get verified/i }).click();

  const modal = page.getByRole('dialog', { name: 'Get your Verified badge' });
  await expect(modal).toBeVisible();
  // DigiLocker, and only DigiLocker: an Aadhaar field on a PuneNest page would be the exact
  // posture this flow was rebuilt to avoid, so its absence is asserted rather than assumed.
  await expect(modal.getByRole('button', { name: 'Continue with DigiLocker' })).toBeVisible();
  await expect(page.getByLabel('OTP digit 1')).toHaveCount(0);
});

test('verification is optional — dismissing it leaves the seeker on the flatmates page', async ({ page }) => {
  await seedUnverified(page);
  await page.goto(`${BASE}/flatmates`);

  await page.getByRole('button', { name: /Get verified/i }).click();
  const modal = page.getByRole('dialog', { name: 'Get your Verified badge' });
  await expect(modal).toBeVisible();

  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(modal).toHaveCount(0);
  // Still on flatmates, still able to browse — the badge is a perk, never a gate.
  await expect(page).toHaveURL(/\/flatmates/);
  await expect(page.getByRole('button', { name: /Move in now —/i })).toBeVisible();
});
