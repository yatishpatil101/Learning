import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew, grantIdentityBadge, apiLogin } from '../../../helpers/liveAuth.js';

// Only staff review can grant the badge; client-side self-grants are security defects.
const PROFILE = '/dashboard?tab=profile';

// Use a fresh account because seeded `verified` flags are shared invariants.
test('entering the verify funnel hands off to capture and grants no badge', async ({ page }) => {
  const mobile = await signedInAsNew(page);

  // The positive assertions lead so the `toHaveCount(0)` cannot pass against an unrendered page.
  await page.goto(PROFILE);

  // Control — unverified means unverified, or "no badge appeared" below is vacuous. Both funnel
  // entry points are present (identity-header chip + badge-section button); the green pill is not.
  await expect(page.getByRole('button', { name: /ID not verified/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Verify identity/i })).toBeVisible();
  await expect(page.getByText('ID verified', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: /Verify identity/i }).click();
  await expect(page).toHaveURL(/\/verify-identity/);

  // Read `/auth/me` because gates and cards use that account contract.
  const me = await apiLogin(mobile);
  expect(me.user.verified, 'reaching the capture screen must not grant the badge').toBe(false);

  await page.goto(PROFILE);
  await expect(page.getByRole('button', { name: /Verify identity/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /ID not verified/i })).toBeVisible();
  await expect(page.getByText('ID verified', { exact: true })).toHaveCount(0);

  // The amber header chip is a button, not decoration — it enters the same funnel as the
  // badge-section CTA, so an unverified user can start from either place.
  await page.getByRole('button', { name: /ID not verified/i }).click();
  await expect(page).toHaveURL(/\/verify-identity/);
});

// The negative test matters only if the same path can grant a badge.
test('once a reviewer confirms, the badge renders and the funnel CTAs retire', async ({ page }) => {
  const mobile = await signedInAsNew(page);

  await page.goto(PROFILE);
  await expect(page.getByRole('button', { name: /ID not verified/i })).toBeVisible();

  // The grant happens server-side, through the real decision path. Nothing in the browser is
  // touched, so what the reload below renders can only have come from the server.
  await grantIdentityBadge(mobile);

  await page.reload();

  await expect(page.getByText('ID verified', { exact: true })).toBeVisible();
  // Both entry points retire together — a verified user offered "Get verified" is a bug that has
  // shipped before, because the two live in different components reading the same hook.
  await expect(page.getByRole('button', { name: /ID not verified/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Verify identity/i })).toHaveCount(0);
});
