import { test, expect } from '../../fixtures/live.js';

// Write flags through the admin API so UI assertions exercise the public flag read as well.
// The fixture restores shared settings after each test to avoid cross-spec contamination.

const BUY = 'p5021';

const ALL_FLAGS = [
  'mapSearch', 'compareProperties', 'savedListings', 'newProjectListings', 'videoListings',
  'scheduleVisit', 'emiCalculator', 'reviewsEnabled', 'reviewModeration',
  'listingVerification', 'kycBadgeEnabled', 'ownerPhonePrivacy', 'paidFeaturedListings',
  'zeroBrokerage', 'subscriptionPlans', 'referralRewards', 'societySaaS',
  'inAppMessaging', 'demoChatSeed', 'whatsappEnabled', 'emailNotifications', 'smsNotifications',
  'pushNotifications', 'signupsEnabled', 'staffLoginEnabled',
];
// Exclude maintenanceMode so the all-off checks still exercise the consumer app.

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

test('compareProperties flag hides the compare control and redirects /compare when disabled', async ({ page, flags }) => {
  await flags.disable('compareProperties');
  await page.goto(`/property/${BUY}`);
  // Wait for page content so a negative assertion cannot pass before rendering.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTitle('Add to Compare')).toHaveCount(0);
  await expect(page.getByTitle('Remove from Compare')).toHaveCount(0);

  await page.goto('/compare');
  await redirectsAway(page, '/compare');
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

test('emiCalculator flag shows and hides the EMI link and guards its route', async ({ page, flags }) => {
  await flags.enable('emiCalculator');
  await page.goto(`/property/${BUY}`);
  await expect(page.locator('a[href="/emi-calculator"]').first()).toBeVisible();

  await flags.disable('emiCalculator');
  await page.goto(`/property/${BUY}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('a[href="/emi-calculator"]')).toHaveCount(0);

  await page.goto('/emi-calculator');
  await redirectsAway(page, '/emi-calculator');
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

test('videoListings flag shows the virtual tour from sm+ only and removes it when disabled', async ({ page, flags }) => {
  // `.main-image-wrapper` is also the floor-plan frame (FloorPlan.jsx), so scope to the first.
  // A descendant selector, not a child one: the hero is a scroll-snap track, so each photo sits
  // a level inside the wrapper.
  const hero = page.locator('.main-image-wrapper img').first();

  // On a phone the hero is full-bleed and swipe-driven, so a labelled pill parked over it costs a photo and
  // sits in the swipe path. The flag still decides whether the tour EXISTS; this is only where it is offered.
  await flags.enable('videoListings');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/property/${BUY}`);
  await expect(hero).toBeVisible();
  await expect(page.getByText('Virtual Tour')).toBeHidden();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByText('Virtual Tour')).toBeVisible();

  await flags.disable('videoListings');
  await page.goto(`/property/${BUY}`);
  await expect(hero).toBeVisible();
  await expect(page.getByText('Virtual Tour')).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(0);
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

// Exclude the mobile bottom nav because it also links to /saved.
const navbarSaved = (page) => page.locator('nav:not(.dz-bottom-nav) a[href="/saved"]');

test('savedListings flag shows and hides the saved link and guards its route', async ({ page, flags, login }) => {
  await flags.enable('savedListings');
  await login.asBuyer();
  await expect(navbarSaved(page).first()).toBeVisible();

  await flags.disable('savedListings');
  await page.goto('/');
  await expect(page.locator('nav.dz-topbar')).toBeVisible();
  await expect(navbarSaved(page)).toHaveCount(0);

  await page.goto('/saved');
  await redirectsAway(page, '/saved');
});

test('pay-rent is the coming-soon page for everyone, with no flag involved', async ({ page, login }) => {
  await login.asTenant();
  await page.goto('/pay-rent');
  await expect(page).toHaveURL(/\/pay-rent/);
  await expect(page.getByText('Rent payments are almost here')).toBeVisible();
});

test('the admin settings console lists every flag group, flags the maintenance switch and opens Admin Modules', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/settings');
  await expect(page.getByText('Site details, the fee schedule')).toBeVisible();

  await page.getByRole('button', { name: 'Feature flags' }).click();
  await expect(page.getByText('Platform-wide feature toggles')).toBeVisible();
  await expect(page.getByText('Discovery & Search').first()).toBeVisible();
  await expect(page.getByText('Communication').first()).toBeVisible();
  await expect(page.getByText('Platform & Access').first()).toBeVisible();

  await page.getByText('Monetization & Payments').first().click();
  await expect(page.getByText('Subscription plans', { exact: true })).toBeVisible();

  await page.getByText('Platform & Access').first().click();
  await expect(page.getByText('Maintenance mode', { exact: true })).toBeVisible();
  await expect(page.getByText('Caution', { exact: true })).toBeVisible();

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