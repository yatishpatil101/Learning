/* Every back-office route is mounted under one RoleRoute (`/admin/*`, with `/ops/*` redirecting into it),
 * so the router's two refusals are asserted once per route here instead of once per desk. The API-side
 * refusals each desk also owns stay in that desk's own spec. */
import { test, expect } from '../../fixtures/live.js';

const ROUTES = [
  { path: '/admin/content', heading: { name: 'Content' } },
  { path: '/admin/enquiries', heading: { name: 'Enquiries & Deals' } },
  { path: '/admin/societies?tab=directory', heading: { name: 'Societies', exact: true } },
  { path: '/admin/settings', heading: { name: 'Settings' } },
  { path: '/admin/localities', heading: null },
  { path: '/admin/properties', heading: null },
  { path: '/ops', heading: { name: 'My Dashboard' } },
  { path: '/ops/rent-agreement', heading: { name: 'Rent Agreement' } },
  { path: '/ops/referrals', heading: { name: 'Referral Verification' } },
  { path: '/ops/support', heading: { name: 'Support queue' } },
  { path: '/ops/drafting-desk', heading: { name: 'Property Valuation' } },
];

async function expectTurnedAway(page, { path, heading }) {
  await page.goto(path);
  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname, path).toBe('/staff-login');
  if (heading) await expect(page.getByRole('heading', heading), path).toHaveCount(0);
}

test('a signed-out visitor is sent to staff-login from every back-office route', async ({ page }) => {
  test.slow();
  for (const route of ROUTES) {
    await test.step(route.path, () => expectTurnedAway(page, route));
  }
});

test('a signed-in buyer is sent to staff-login from every back-office route', async ({ page, login }) => {
  test.slow();
  await login.asBuyer();
  for (const route of ROUTES) {
    await test.step(route.path, () => expectTurnedAway(page, route));
  }
});
