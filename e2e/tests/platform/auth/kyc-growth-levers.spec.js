import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew, grantIdentityBadge } from '../../../helpers/liveAuth.js';

/* Owns the dashboard badge CTA (ADR-019, badge-not-gate); the profile surface belongs to
   `verify-funnel.spec.js`. Actors are fresh: seeded `verified` states are published invariants. */

const badgeCta = (page) => page.getByTestId('verify-badge-cta');

test('an unverified user sees the opt-in badge CTA on the dashboard', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto('/dashboard');

  await expect(badgeCta(page)).toBeVisible();
  await expect(badgeCta(page).getByText('Optional', { exact: false })).toBeVisible();
});

test('a verified user does NOT see the badge CTA (auto-hides once earned)', async ({ page }) => {
  const mobile = await signedInAsNew(page);
  // Granted server-side through the real approval path, so the absence below is the server's answer
  // rather than a value the test wrote into the browser.
  await grantIdentityBadge(mobile);

  await page.goto('/dashboard');

  // Anchor on the sidebar tab, which the Overview always renders: `toHaveCount(0)` against a page
  // that has not finished rendering passes for the wrong reason.
  await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible();
  await expect(badgeCta(page)).toHaveCount(0);
});

test('the CTA retires the moment a reviewer confirms', async ({ page }) => {
  const mobile = await signedInAsNew(page);
  await page.goto('/dashboard');
  await expect(badgeCta(page)).toBeVisible();

  await grantIdentityBadge(mobile);
  await page.reload();

  await expect(badgeCta(page)).toHaveCount(0);
});

test('the badge is optional — backing out of capture keeps the user on the dashboard, nothing gated', async ({ page }) => {
  const mobile = await signedInAsNew(page);
  await page.goto('/dashboard');

  await page.getByTestId('verify-badge-btn').click();
  /* The offer is a route, not a dialog — `VerifyIdentityRedirect` navigates and renders nothing —
     so backing out is a history step rather than a close button. */
  await expect(page).toHaveURL(/\/verify-identity/);

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(badgeCta(page)).toBeVisible();

  // And the server agrees the user is still unverified. The seeded version read this back out of
  // localStorage, which could only ever confirm that the test had not written anything.
  const res = await fetch(`${API}/me/verification/identity`, { headers: await authHeaders(mobile) });
  expect(res.ok).toBe(true);
  expect((await res.json()).status).toBe('none');
});
