import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew, grantIdentityBadge } from '../../../helpers/liveAuth.js';

// Owns the dashboard badge CTA (ADR-019, badge-not-gate); the profile surface belongs to `verify-funnel.spec.js`.
const badgeCta = (page) => page.getByTestId('verify-badge-cta');

test('an unverified user sees the opt-in badge CTA on the dashboard', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto('/dashboard');

  await expect(badgeCta(page)).toBeVisible();
  await expect(badgeCta(page).getByText('Optional', { exact: false })).toBeVisible();
});

test('the CTA retires the moment a reviewer confirms', async ({ page }) => {
  const mobile = await signedInAsNew(page);
  await page.goto('/dashboard');
  await expect(badgeCta(page)).toBeVisible();

  // Granted server-side through the real approval path, so the absence below is the server's answer
  // rather than a value the test wrote into the browser.
  await grantIdentityBadge(mobile);
  await page.reload();

  await expect(page.getByRole('complementary').getByRole('button', { name: 'Home', exact: true })).toBeVisible();
  await expect(badgeCta(page)).toHaveCount(0);
});

test('the badge is optional — backing out of capture keeps the user on the dashboard, nothing gated', async ({ page }) => {
  const mobile = await signedInAsNew(page);
  await page.goto('/dashboard');

  await page.getByTestId('verify-badge-btn').click();
  // The offer is a route, so backing out is history, not a close button.
  await expect(page).toHaveURL(/\/verify-identity/);

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(badgeCta(page)).toBeVisible();

  // And the server agrees the user is still unverified.
  const res = await fetch(`${API}/me/verification/identity`, { headers: await authHeaders(mobile) });
  expect(res.ok).toBe(true);
  expect((await res.json()).status).toBe('none');
});
