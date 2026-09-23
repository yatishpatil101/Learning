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

test.describe('mapSearch flag', () => {
  test('map view button visible when enabled', async ({ page, flags }) => {
    await flags.enable('mapSearch');
    await page.goto('/listings?deal=buy');
    await expect(page.locator('[title="Map view"]:visible')).toBeVisible();
  });

  test('map view button hidden when disabled', async ({ page, flags }) => {
    await flags.disable('mapSearch');
    await page.goto('/listings?deal=buy');
    await expect(page.getByTitle('Map view')).toBeHidden();
  });
});


test.describe('compareProperties flag', () => {
  test('compare control visible in property details when enabled', async ({ page, flags }) => {
    await flags.enable('compareProperties');
    await page.goto(`/property/${BUY}`);
    await expect(page.getByTitle('Add to Compare', { exact: true })).toBeVisible();
  });

  test('compare control hidden in property details when disabled', async ({ page, flags }) => {
    await flags.disable('compareProperties');
    await page.goto(`/property/${BUY}`);
    // Wait for page content so a negative assertion cannot pass before rendering.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTitle('Add to Compare')).toHaveCount(0);
    await expect(page.getByTitle('Remove from Compare')).toHaveCount(0);
  });

  test('compare route redirects to / when disabled', async ({ page, flags }) => {
    await flags.disable('compareProperties');
    await page.goto('/compare');
    await page.waitForURL((url) => !url.toString().includes('/compare'));
    expect(page.url()).not.toContain('/compare');
  });
});


test.describe('scheduleVisit flag', () => {
  test('visit button visible on property page when enabled', async ({ page, flags }) => {
    await flags.enable('scheduleVisit');
    await page.goto(`/property/${BUY}`);
    await expect(page.getByRole('button', { name: /Visit/i }).first()).toBeVisible();
  });

  test('visit button hidden on property page when disabled', async ({ page, flags }) => {
    await flags.disable('scheduleVisit');
    await page.goto(`/property/${BUY}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const visitButtons = page
      .locator('button:has-text("Visit"), a:has-text("Visit")')
      .filter({ hasText: /^Visit$/ });
    await expect(visitButtons).toHaveCount(0);
  });

  test('schedule-visit route redirects when disabled', async ({ page, flags, login }) => {
    await flags.disable('scheduleVisit');
    await login.asBuyer();
    await page.goto(`/schedule-visit?listing=${BUY}`);
    await page.waitForURL((url) => !url.toString().includes('/schedule-visit'));
    expect(page.url()).not.toContain('/schedule-visit');
  });
});


test.describe('emiCalculator flag', () => {
  test('EMI calculator link visible when enabled', async ({ page, flags }) => {
    await flags.enable('emiCalculator');
    await page.goto(`/property/${BUY}`);
    await expect(page.locator('a[href="/emi-calculator"]').first()).toBeVisible();
  });

  test('EMI calculator link hidden when disabled', async ({ page, flags }) => {
    await flags.disable('emiCalculator');
    await page.goto(`/property/${BUY}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('a[href="/emi-calculator"]')).toHaveCount(0);
  });

  test('emi-calculator route redirects when disabled', async ({ page, flags }) => {
    await flags.disable('emiCalculator');
    await page.goto('/emi-calculator');
    await page.waitForURL((url) => !url.toString().includes('/emi-calculator'));
    expect(page.url()).not.toContain('/emi-calculator');
  });
});


test.describe('reviewsEnabled flag', () => {
  test('reviews section visible on property page when enabled', async ({ page, flags }) => {
    await flags.enable('reviewsEnabled');
    // p5021 carries the seed's one published review, so "enabled" has something to render.
    await page.goto(`/property/${BUY}`);
    await page.getByRole('tab', { name: /Amenities & Society/i }).click();
    await expect(page.getByText(/review/i).first()).toBeVisible();
  });

  test('reviews section hidden on property page when disabled', async ({ page, flags }) => {
    await flags.disable('reviewsEnabled');
    await page.goto(`/property/${BUY}`);
    await page.getByRole('tab', { name: /Amenities & Society/i }).click();
    await expect(page.locator('h2:has-text("Reviews")')).toHaveCount(0);
  });
});


test.describe('videoListings flag', () => {
  /* `.main-image-wrapper` is also the floor-plan frame (FloorPlan.jsx), so scope to the first.
     A descendant selector, not a child one: the hero is a scroll-snap track, so each photo sits
     a level inside the wrapper. */
  const hero = (page) => page.locator('.main-image-wrapper img').first();

  test('virtual tour button visible when enabled', async ({ page, flags }) => {
    await flags.enable('videoListings');
    await page.goto(`/property/${BUY}`);
    await expect(hero(page)).toBeVisible();
    await expect(page.getByText('Virtual Tour')).toBeVisible();
  });

  test('virtual tour button hidden when disabled', async ({ page, flags }) => {
    await flags.disable('videoListings');
    await page.goto(`/property/${BUY}`);
    await expect(hero(page)).toBeVisible();
    await expect(page.getByText('Virtual Tour')).toHaveCount(0);
    await expect(page.locator('video')).toHaveCount(0);
  });

  /* On a phone the hero is full-bleed and swipe-driven, so a labelled pill parked over it costs a photo and
     sits in the swipe path. The flag still decides whether the tour EXISTS; this is only where it is offered. */
  test('the tour pill is offered from sm+ only, not over the phone hero', async ({ page, flags }) => {
    await flags.enable('videoListings');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/property/${BUY}`);
    await expect(hero(page)).toBeVisible();
    await expect(page.getByText('Virtual Tour')).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByText('Virtual Tour')).toBeVisible();
  });
});


test.describe('inAppMessaging flag', () => {
  test('messages link visible in navbar when enabled and signed in', async ({ page, flags, login }) => {
    await flags.enable('inAppMessaging');
    await login.asBuyer();
    await expect(page.locator('a[href="/messages"]')).toBeVisible();
  });

  test('messages link hidden in navbar when disabled', async ({ page, flags, login }) => {
    await flags.disable('inAppMessaging');
    await login.asBuyer();
    await expect(page.locator('a[href="/messages"]')).toBeHidden();
  });

  test('messages route redirects when disabled', async ({ page, flags, login }) => {
    await flags.disable('inAppMessaging');
    await login.asBuyer();
    await page.goto('/messages');
    await page.waitForURL((url) => !url.toString().includes('/messages'));
    expect(page.url()).not.toContain('/messages');
  });
});

// Exclude the mobile bottom nav because it also links to /saved.
const navbarSaved = (page) => page.locator('nav:not(.dz-bottom-nav) a[href="/saved"]');

test.describe('savedListings flag', () => {
  test('saved link visible in navbar when enabled and signed in', async ({ page, flags, login }) => {
    await flags.enable('savedListings');
    await login.asBuyer();
    await expect(navbarSaved(page).first()).toBeVisible();
  });

  test('saved link hidden in navbar when disabled', async ({ page, flags, login }) => {
    await flags.disable('savedListings');
    await login.asBuyer();
    await expect(navbarSaved(page)).toHaveCount(0);
  });

  test('saved route redirects when disabled', async ({ page, flags, login }) => {
    await flags.disable('savedListings');
    await login.asBuyer();
    await page.goto('/saved');
    await page.waitForURL((url) => !url.toString().includes('/saved'));
    expect(page.url()).not.toContain('/saved');
  });
});


test.describe('pay-rent has no flag left to switch', () => {
  // An unavailable payment rail must not present a working payment flow.
  test('pay-rent is the coming-soon page for everyone, with no flag involved', async ({ page, login }) => {
    await login.asTenant();
    await page.goto('/pay-rent');
    await expect(page).toHaveURL(/\/pay-rent/);
    await expect(page.getByText('Rent payments are almost here')).toBeVisible();
  });
});


test('listings page survives every flag being off', async ({ page, flags, consoleErrors }) => {
  await flags.disable(...ALL_FLAGS);
  await page.goto('/listings?deal=buy');
  await expect(page.getByText(/properties/i).first()).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

test('property page survives every flag being off', async ({ page, flags, consoleErrors }) => {
  await flags.disable(...ALL_FLAGS);
  await page.goto(`/property/${BUY}`);
  await expect(page.locator('#main-content').first()).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});
