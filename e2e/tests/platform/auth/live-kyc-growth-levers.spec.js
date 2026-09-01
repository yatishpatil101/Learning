import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew, grantAadhaarBadge } from '../../../helpers/liveAuth.js';

/* KYC growth levers (ADR-019, badge-not-gate), against the live API.
 *
 * The dashboard Overview carries an opt-in "Get your Verified badge" card. It is a trust prompt and
 * never a wall: it shows only to an unverified user, retires the moment the badge is earned, and
 * blocks nothing on the way past. This spec owns that card. Its neighbour
 * `live-verify-funnel.spec.js` owns the same funnel on the **profile** surface — worth keeping both,
 * because the CTA and the pill live in different components reading the same hook, and "verified
 * user still offered verification" is a bug that has shipped before.
 *
 * ## What changed in the port
 *
 * The seeded third test clicked "Continue with DigiLocker" and asserted a badge appeared, because
 * the mock granted inline. That transition does not exist live and must not (D21): the start call
 * answers 202 with a hosted consent URL and only the signed webhook grants. `live-verify-funnel`
 * already asserts that handoff in full, so repeating it here would be duplication. What this spec
 * keeps is the half that is genuinely its own — **the card retires once the badge is real** — driven
 * through the `@DevOnly` simulate endpoint, which runs the production webhook handler.
 *
 * Every actor is freshly registered. The card is only visible to an unverified user, and the two
 * seeded candidates are both unusable: Rahul is `verified = true`, and Arjun's `verified = false` is
 * published as an invariant in `docs/system/fixture-registry.md`, so granting him a badge here would
 * break another spec's premise on a database that persists for the whole run.
 */

const badgeCta = (page) => page.getByTestId('verify-badge-cta');
const badgeModal = (page) => page.getByRole('dialog', { name: 'Get your Verified badge' });

test('an unverified user sees the opt-in badge CTA on the dashboard', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto('/dashboard');

  await expect(badgeCta(page)).toBeVisible();
  await expect(badgeCta(page).getByText('Optional', { exact: false })).toBeVisible();
});

test('a verified user does NOT see the badge CTA (auto-hides once earned)', async ({ page }) => {
  const mobile = await signedInAsNew(page);
  // Granted server-side through the real webhook path, so the absence below is the server's answer
  // rather than a value the test wrote into the browser.
  await grantAadhaarBadge(mobile);

  await page.goto('/dashboard');

  // Anchor on the sidebar tab, which the Overview always renders: `toHaveCount(0)` against a page
  // that has not finished rendering passes for the wrong reason.
  await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible();
  await expect(badgeCta(page)).toHaveCount(0);
});

test('the CTA retires the moment the provider confirms', async ({ page }) => {
  const mobile = await signedInAsNew(page);
  await page.goto('/dashboard');
  await expect(badgeCta(page)).toBeVisible();

  await grantAadhaarBadge(mobile);
  await page.reload();

  await expect(badgeCta(page)).toHaveCount(0);
});

test('the badge is optional — dismissing DigiLocker keeps the user on the dashboard, nothing gated', async ({ page }) => {
  const mobile = await signedInAsNew(page);
  await page.goto('/dashboard');

  await page.getByTestId('verify-badge-btn').click();
  await expect(badgeModal(page)).toBeVisible();

  // "Maybe later" closes the flow without starting it — no wall, no redirect, no grant.
  await page.getByRole('button', { name: 'Maybe later' }).click();
  await expect(badgeModal(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(badgeCta(page)).toBeVisible();

  // And the server agrees the user is still unverified. The seeded version read this back out of
  // localStorage, which could only ever confirm that the test had not written anything.
  const res = await fetch(`${API}/me/verification/aadhaar`, { headers: await authHeaders(mobile) });
  expect(res.ok).toBe(true);
  expect((await res.json()).verified).toBeFalsy();
});
