import { test, expect } from '../../../fixtures/base.js';

/* The verify funnel's *rendered payoff* on the account surface — tech-debt D21:
 * open the modal → complete the DigiLocker mock → the Verified badge visibly
 * appears on the profile.
 *
 * What the neighbours already own, and why none of them close this:
 *   - `kyc-growth-levers.spec.js` drives modal → mock on the dashboard Overview,
 *     but asserts the *disappearance* of the opt-in CTA and the persisted
 *     localStorage flag — never that a positive "Verified" pill renders.
 *   - `verify-payoff.spec.js` (D95) drives the same funnel but asserts the
 *     *store* (`ownerVerified` flips, one-shot Featured perk); it says outright
 *     that "checking a pill on the owner's own screen would prove the label
 *     rendered, not that the reward was granted" — so it deliberately does not.
 *   - `seeker-verify.spec.js` only asserts the flatmates CTA *opens* the modal;
 *     it never completes the mock and never earns a badge.
 * So the "badge appears" half — a green ribbon rendering on a user surface once
 * the funnel completes — was uncovered on the dashboard Profile & Settings tab.
 * (`tenant-profile.spec.js` covers the analogous render on the *separate*
 * `/tenant-profile` mirror page, not this account tab.)
 *
 * The badge flips through `VerificationContext`, not a callback: a mock grant
 * re-reads the seam and every consumer re-renders, so `ProfileTab` lights the
 * "ID verified" chip on its own. That is exactly the render this asserts. */

const PROFILE = '/dashboard?tab=profile';

test('Profile tab verify funnel: modal → DigiLocker mock → the Verified badge renders', async ({ page, login, consoleErrors }) => {
  await login.asBuyer();                       // seeded signed-in, NO aadhaar key → unverified
  await page.goto(PROFILE, { waitUntil: 'networkidle' });

  // Control — unverified means unverified, or the "appears" assertion below is
  // meaningless against a fixture that was already flipped. Both funnel entry
  // points are present (identity-header chip + badge-section button); the green
  // "ID verified" chip is not.
  await expect(page.getByRole('button', { name: /ID not verified/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Get verified/i })).toBeVisible();
  await expect(page.getByText('ID verified', { exact: true })).toHaveCount(0);

  // Open the modal — DigiLocker-only, never an Aadhaar field on a PuneNest page.
  await page.getByRole('button', { name: /Get verified/i }).click();
  const modal = page.getByRole('dialog', { name: 'Get your Verified badge' });
  await expect(modal).toBeVisible();
  const digilocker = modal.getByRole('button', { name: /continue with digilocker/i });
  await expect(digilocker).toBeVisible();

  // Complete the mock round-trip (~1.7s timer, so wait on the effect not a delay).
  await digilocker.click();
  await expect(modal).toHaveCount(0, { timeout: 15000 });

  // The badge appears — the green "ID verified" chip renders and both "get
  // verified" prompts retire. This is the D21 gap: a rendered pill, not a store flag.
  await expect(page.getByText('ID verified', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /Get verified/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /ID not verified/i })).toHaveCount(0);

  // It reflects real persisted state, not a one-render artifact: reload and the
  // chip is still there, still with no re-nudge.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('ID verified', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Get verified/i })).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test('the identity-header "ID not verified" chip is a second funnel entry point', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto(PROFILE, { waitUntil: 'networkidle' });

  // The amber header chip is a button, not decoration — it opens the same modal
  // as the badge-section CTA, so an unverified user can start the funnel from
  // either place.
  await page.getByRole('button', { name: /ID not verified/i }).click();
  await expect(page.getByRole('dialog', { name: 'Get your Verified badge' })).toBeVisible();
});
