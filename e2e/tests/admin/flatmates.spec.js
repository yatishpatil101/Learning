import { test, expect } from '../../fixtures/base.js';

/**
 * `/admin/flatmates` — **retired**, and this file is what is left of its suite.
 *
 * The page was a fourth flatmate desk on the mock. It moderated seekers, groups and group
 * applications out of `db.json`; it could not see rooms at all (the primary "Move in now" supply);
 * and it knew only one of the two verdicts a flatmate row carries, so it had no view of the D72
 * publication axis. `/ops/flatmate-review` does the same three jobs against the real API and adds
 * the host-verification queue this page never had, so keeping both would have meant two screens
 * over one contract, drifting.
 *
 * The route is a redirect rather than a deletion, because operators have it bookmarked and it is
 * still named in the flow docs. **The guards stay on the redirect** — an admin without the
 * Flatmates module, or with the flag off, should be refused here rather than bounced onto a desk
 * they may not open — and that is the one thing a redirect can quietly get wrong, so it is what
 * these three tests check.
 *
 * The behaviour that used to live here is now
 * `e2e/tests/ops/live-flatmate-moderation.spec.js` (6 tests, live).
 */

test('the retired desk hands the operator to the live one', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/flatmates');

  await page.waitForURL('**/ops/flatmate-review');
  expect(new URL(page.url()).pathname).toBe('/ops/flatmate-review');
  await expect(page.getByRole('heading', { name: 'Flatmate Moderation' })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('unauthenticated visitor is redirected to staff-login, not to the ops desk', async ({ page }) => {
  await page.goto('/admin/flatmates');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
});

test('a buyer cannot reach the ops desk through the retired route', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/flatmates');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
});
