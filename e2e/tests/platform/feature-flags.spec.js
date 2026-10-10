import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, STAFF_PASSWORD, authHeaders, apiLogin, staffEmail, uniqueMobile } from '../../helpers/liveAuth.js';

// Write flags through the admin API so UI assertions exercise the public flag read as well.
// The fixture restores shared settings after each test to avoid cross-spec contamination.

const BUY = 'p5021';
const FREE_PLAN = 'b1000000-0000-4000-8000-000000000001';

const ALL_FLAGS = [
  'mapSearch', 'scheduleVisit', 'reviewsEnabled', 'inAppMessaging', 'assistant',
  'kycBadgeEnabled', 'subscriptionPlans', 'referralRewards',
  'signupsEnabled', 'staffLoginEnabled',
];
// Exclude maintenanceMode so the all-off checks still exercise the consumer app.

const post = (path, body, headers = {}) => fetch(`${API}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const redirectsAway = async (page, path) => {
  await page.waitForURL((url) => !url.toString().includes(path));
  expect(page.url()).not.toContain(path);
};

test('mapSearch flag shows and hides the map view button', async ({ page, flags }) => {
  await flags.enable('mapSearch');
  await page.goto('/listings?deal=buy');
  await expect(page.locator('[title="Map view"]:visible')).toBeVisible();

  await flags.disable('mapSearch');
  await page.goto('/listings?deal=buy');
  await expect(page.getByTitle('Map view')).toBeHidden();
});

test('scheduleVisit flag shows and hides the visit button and guards its route', async ({ page, flags, login }) => {
  await flags.enable('scheduleVisit');
  await page.goto(`/property/${BUY}`);
  await expect(page.getByRole('button', { name: /Visit/i }).first()).toBeVisible();

  await flags.disable('scheduleVisit');
  await page.goto(`/property/${BUY}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const visitButtons = page
    .locator('button:has-text("Visit"), a:has-text("Visit")')
    .filter({ hasText: /^Visit$/ });
  await expect(visitButtons).toHaveCount(0);

  await login.asBuyer();
  await page.goto(`/schedule-visit?listing=${BUY}`);
  await redirectsAway(page, '/schedule-visit');
});

test('reviewsEnabled flag shows and hides the reviews section', async ({ page, flags }) => {
  // p5021 carries the seed's one published review, so "enabled" has something to render.
  await flags.enable('reviewsEnabled');
  await page.goto(`/property/${BUY}`);
  await page.getByRole('tab', { name: /Amenities & Society/i }).click();
  await expect(page.getByText(/review/i).first()).toBeVisible();

  await flags.disable('reviewsEnabled');
  await page.goto(`/property/${BUY}`);
  await page.getByRole('tab', { name: /Amenities & Society/i }).click();
  await expect(page.locator('h2:has-text("Reviews")')).toHaveCount(0);
});

test('inAppMessaging flag shows and hides the messages link and guards its route', async ({ page, flags, login }) => {
  await flags.enable('inAppMessaging');
  await login.asBuyer();
  await expect(page.locator('a[href="/messages"]')).toBeVisible();

  await flags.disable('inAppMessaging');
  await page.goto('/');
  await expect(page.locator('nav.dz-topbar')).toBeVisible();
  await expect(page.locator('a[href="/messages"]')).toBeHidden();

  await page.goto('/messages');
  await redirectsAway(page, '/messages');
});

test('pay-rent is the coming-soon page for everyone, with no flag involved', async ({ page, login }) => {
  await login.asTenant();
  await page.goto('/pay-rent');
  await expect(page).toHaveURL(/\/pay-rent/);
  await expect(page.getByText('Rent payments are almost here')).toBeVisible();
});

test('the admin settings console lists every flag group, flags the maintenance switch and opens Admin Modules', async ({ page, login, flags, consoleErrors }) => {
  await flags.enable('signupsEnabled', 'staffLoginEnabled');
  await flags.disable('maintenanceMode');
  await login.asAdmin();
  await page.goto('/admin/settings');
  await expect(page.getByText('Site details, the fee schedule')).toBeVisible();

  await page.getByRole('tab', { name: 'Feature flags' }).click();
  await expect(page.getByText('Platform-wide feature toggles')).toBeVisible();
  for (const group of ['Discovery & Engagement', 'Trust', 'Monetization & Payments', 'Platform & Access']) {
    await expect(page.getByRole('button', { name: new RegExp(group) })).toBeVisible();
  }
  // Maintenance is the one switch whose "on" is the exception, so two of three reads as healthy.
  await expect(page.getByRole('button', { name: /Platform & Access/ })).toContainText('2/3 active');

  await page.getByRole('button', { name: /Discovery & Engagement/ }).click();
  await expect(page.getByRole('switch', { name: 'Toggle Assistant' })).toBeVisible();

  await page.getByRole('button', { name: /Monetization & Payments/ }).click();
  await expect(page.getByText('Plan purchases', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Platform & Access/ }).click();
  await expect(page.getByText('Maintenance mode', { exact: true })).toBeVisible();
  await expect(page.getByText('Caution', { exact: true })).toBeVisible();

  for (const gone of ['Compare properties', 'Saved listings', 'EMI calculator', 'Video listings', 'Zero brokerage', 'WhatsApp', 'Email notifications']) {
    await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'Admin Modules' }).click();
  await expect(page.getByText(/Control admin panel features/)).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test('listing and property pages survive every flag being off', async ({ page, flags, consoleErrors }) => {
  await flags.disable(...ALL_FLAGS);

  await page.goto('/listings?deal=buy');
  await expect(page.getByText(/properties/i).first()).toBeVisible();

  await page.goto(`/property/${BUY}`);
  await expect(page.locator('#main-content').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});
/* Removed switches must not gate anything: a stale stored false in the settings document
   would hide the feature with no way back. */
test('retired flags stored as off no longer hide compare, saved or the EMI calculator', async ({ page, flags, login }) => {
  await flags.disable('compareProperties', 'savedListings', 'emiCalculator', 'videoListings', 'paidFeaturedListings');
  await login.asBuyer();

  await page.goto(`/property/${BUY}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTitle(/(Add to|Remove from) Compare/).first()).toBeVisible();
  await expect(page.locator('a[href="/emi-calculator"]').first()).toBeVisible();
  await expect(page.getByText('Virtual Tour')).toHaveCount(0);

  for (const path of ['/compare', '/saved', '/emi-calculator']) {
    await page.goto(path);
    await expect(page.locator('#main-content').first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
  }
});

test('assistant flag shows and hides the help assistant', async ({ page, flags }) => {
  const fab = page.getByRole('button', { name: /^(Ask|Open) Draaz\b/i });
  await flags.enable('assistant');
  await page.goto('/');
  await expect(fab.first()).toBeVisible();

  await flags.disable('assistant');
  await page.goto('/');
  await expect(page.locator('nav.dz-topbar')).toBeVisible();
  await expect(fab).toHaveCount(0);
});

test('kycBadgeEnabled flag guards the identity verification route', async ({ page, flags, login }) => {
  await flags.disable('kycBadgeEnabled');
  await login.asNewOwner();
  await page.goto('/verify-identity');
  await redirectsAway(page, '/verify-identity');

  await flags.enable('kycBadgeEnabled');
  await page.goto('/verify-identity');
  await expect(page.getByRole('heading', { name: 'Use your phone', exact: true })).toBeVisible();
});

test('the slug-less /society route is gone, and the retired societySaaS flag is not a switch any more', async ({ page }) => {
  await page.goto('/society');
  await expect(page.getByText('Page not found').first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/society');

  const bootstrap = await (await fetch(`${API}/bootstrap`)).json();
  expect(bootstrap.flags, 'societySaaS left the flag document').not.toHaveProperty('societySaaS');
});

test('subscriptionPlans flag pauses checkout on the page and at the server', async ({ page, flags, login }) => {
  const pausedHeading = page.getByRole('heading', { name: 'Plan purchases are paused' });
  const pay = page.getByRole('button', { name: /^Pay/ }).first();

  await flags.disable('subscriptionPlans');
  await login.asBuyer();
  await page.goto('/checkout?plan=seeker-plus');
  await expect(pausedHeading).toBeVisible();
  await expect(page.getByRole('button', { name: /^Pay/ })).toHaveCount(0);

  const { accessToken } = await apiLogin(uniqueMobile());
  const refused = await post('/me/subscription', { planId: FREE_PLAN }, { authorization: `Bearer ${accessToken}` });
  expect(refused.status).toBe(403);
  expect((await refused.json()).error).toBe('purchases_paused');

  await flags.enable('subscriptionPlans');
  await page.reload();
  await expect(pay).toBeVisible();
  await expect(pausedHeading).toHaveCount(0);

  // A tab opened before the switch flipped still meets the server's refusal, in words.
  await flags.disable('subscriptionPlans');
  await pay.click();
  await expect(page.getByRole('alert')).toContainText('paused new purchases');
});

test('signupsEnabled flag refuses a new account at the server and lets an existing one in', async ({ flags }) => {
  await flags.disable('signupsEnabled');
  const fresh = uniqueMobile();
  await post('/auth/login', { mobile: fresh });
  const refused = await post('/auth/login', { mobile: fresh, otp: process.env.E2E_OTP_CODE || '000000' });
  expect(refused.status).toBe(403);
  expect((await refused.json()).error).toBe('signups_closed');

  await expect(apiLogin(ACTORS.buyer)).resolves.toHaveProperty('accessToken');

  await flags.enable('signupsEnabled');
  await expect(apiLogin(uniqueMobile())).resolves.toHaveProperty('accessToken');
});

test('staffLoginEnabled flag stops staff passwords but never an administrator', async ({ flags }) => {
  const staffStep = () => post('/auth/staff-login', { email: staffEmail(STAFF.rental), password: STAFF_PASSWORD });

  await flags.disable('staffLoginEnabled');
  expect((await staffStep()).status).toBe(403);
  expect((await post('/auth/staff-login', { email: staffEmail(ACTORS.admin), password: STAFF_PASSWORD })).status).toBe(200);

  await flags.enable('staffLoginEnabled');
  expect((await staffStep()).status).toBe(200);
});

test('maintenanceMode flag blocks consumer pages and writes, and leaves the back office open', async ({ page, flags }) => {
  const buyer = await authHeaders(ACTORS.buyer);
  await flags.enable('maintenanceMode');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /right back/ })).toBeVisible();
  const write = await fetch(`${API}/me/saved/${BUY}`, { method: 'PUT', headers: buyer });
  expect(write.status).toBe(503);
  expect((await write.json()).error).toBe('maintenance_mode');

  await flags.disable('maintenanceMode');
  await page.goto('/');
  await expect(page.locator('nav.dz-topbar')).toBeVisible();
  await expect(page.getByRole('heading', { name: /right back/ })).toHaveCount(0);
});
