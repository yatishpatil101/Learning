import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew, grantIdentityBadge, apiLogin } from '../../../helpers/liveAuth.js';

/* Only a staff reviewer can grant the identity badge, so a client that talks itself into one is a
 * security defect; the simulate endpoint drives the real decision path rather than faking it. */

const PROFILE = '/dashboard?tab=profile';

/* A fresh auto-registered account, because the seeded buyers' `verified` flags are invariants other
 * specs lean on and the e2e database persists for the whole run. */

test('entering the verify funnel hands off to capture and grants no badge', async ({ page }) => {
  const mobile = await signedInAsNew(page);    // brand-new account, so NOT verified

  await page.goto(PROFILE);

  // Control — unverified means unverified, or "no badge appeared" below is vacuous. Both funnel
  // entry points are present (identity-header chip + badge-section button); the green pill is not.
  await expect(page.getByRole('button', { name: /ID not verified/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Get verified/i })).toBeVisible();
  await expect(page.getByText('ID verified', { exact: true })).toHaveCount(0);

  /* The offer is a route, not a dialog: `VerifyIdentityRedirect` navigates and renders nothing, so
     a dialog assertion here would name an element that exists nowhere and pass vacuously. */
  await page.getByRole('button', { name: /Get verified/i }).click();
  await expect(page).toHaveURL(/\/verify-identity/);

  /* Ask the server rather than read the screen: the claim is about the account, and `/auth/me` is
     the same answer the contact gate and the owner card work from. */
  const me = await apiLogin(mobile);
  expect(me.user.verified, 'reaching the capture screen must not grant the badge').toBe(false);

  /* A fresh navigation catches a client-side optimistic flip an in-page check would miss. The
   * positive assertions lead so the `toHaveCount(0)` cannot pass against an unrendered page. */
  await page.goto(PROFILE);
  await expect(page.getByRole('button', { name: /Get verified/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /ID not verified/i })).toBeVisible();
  await expect(page.getByText('ID verified', { exact: true })).toHaveCount(0);
});

test('the identity-header "ID not verified" chip is a second funnel entry point', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto(PROFILE);

  // The amber header chip is a button, not decoration — it enters the same funnel as the
  // badge-section CTA, so an unverified user can start from either place.
  await page.getByRole('button', { name: /ID not verified/i }).click();
  await expect(page).toHaveURL(/\/verify-identity/);
});

/* "Entering grants nothing" only means something if a grant *can* happen — without this pair the
 * test above would pass just as happily against a badge feature that was entirely broken. */
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
  await expect(page.getByRole('button', { name: /Get verified/i })).toHaveCount(0);
});
