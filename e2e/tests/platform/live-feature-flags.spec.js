import { test, expect } from '../../fixtures/live.js';

/**
 * Feature flags, end to end, against the real server.
 *
 * ## What moving this off the mock actually proves
 *
 * The seeded version wrote `settings.flags` into local storage and asserted the UI reacted. That
 * proved the *rendering* half of the feature and quietly assumed the half that was broken: until
 * `GET /flags` existed, the admin console wrote flags to the API and the browser read a copy from
 * local storage that nothing ever updated. Maintenance mode reported success and served the site.
 * The old spec passed throughout, because it was writing to the same place the client was reading.
 *
 * Here the write goes through `PUT /admin/settings` — the only writer there is — and the read is
 * whatever the browser makes of `GET /flags`. Nothing in the test touches what the page reads. That
 * is the whole point: a flag is only real if the person flipping it and the person seeing it are
 * looking at the same value.
 *
 * ## Two things the seeded version was not testing
 *
 * Its final two cases ("no page errors with all flags disabled") read `puneNestDB_v1` — a store key
 * three versions stale. `JSON.parse(null)` gave `null`, the guard returned silently, and both tests
 * asserted a page with **all flags enabled** renders without errors, under a name claiming the
 * opposite. They passed for years by testing nothing. The versions below disable the flags for
 * real, so a component that assumes its own feature is on now fails here.
 *
 * ## Fixtures
 *
 * Assertions are pinned to `p5021` (Meera's approved buy listing) rather than "the first card",
 * because the flags being tested change what renders on a property page and a spec that navigates
 * by clicking is one layout change away from asserting about a different listing. See
 * `docs/system/fixture-registry.md`.
 *
 * The `flags` fixture restores what it changed even when a test fails. Flags are one row shared by
 * the whole run, so a leaked toggle does not fail here — it fails somewhere else, later, looking
 * like flakiness.
 */

const BUY = 'p5021';

/** The full consumer vocabulary from `AppFlagsPanel`, for the all-off smoke tests. */
const ALL_FLAGS = [
  'mapSearch', 'compareProperties', 'savedListings', 'newProjectListings', 'videoListings',
  'scheduleVisit', 'emiCalculator', 'reviewsEnabled', 'reviewModeration',
  'listingVerification', 'kycBadgeEnabled', 'ownerPhonePrivacy', 'paidFeaturedListings',
  'zeroBrokerage', 'subscriptionPlans', 'referralRewards', 'onlineRentPayment', 'societySaaS',
  'inAppMessaging', 'demoChatSeed', 'whatsappEnabled', 'emailNotifications', 'smsNotifications',
  'pushNotifications', 'signupsEnabled', 'staffLoginEnabled',
];
// `maintenanceMode` is deliberately absent: switching it on blanks the consumer app, so an
// "everything off" smoke test would assert the maintenance screen renders rather than that the
// product survives losing its features. It has its own coverage.

// ─────────────── MAP SEARCH ───────────────

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

// ─────────────── COMPARE ───────────────

test.describe('compareProperties flag', () => {
  test('compare control visible in property details when enabled', async ({ page, flags }) => {
    await flags.enable('compareProperties');
    await page.goto(`/property/${BUY}`);
    await expect(page.getByTitle('Add to Compare', { exact: true })).toBeVisible();
  });

  test('compare control hidden in property details when disabled', async ({ page, flags }) => {
    await flags.disable('compareProperties');
    await page.goto(`/property/${BUY}`);
    // Wait for something the page always renders before asserting an absence, so "not there yet"
    // cannot pass as "not there".
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

// ─────────────── SCHEDULE VISIT ───────────────

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

// ─────────────── EMI CALCULATOR ───────────────

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

// ─────────────── REVIEWS ───────────────

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

// ─────────────── VIDEO LISTINGS ───────────────

test.describe('videoListings flag', () => {
  // The virtual-tour button is gated on the flag alone, not on the listing actually carrying a
  // video (`Gallery.jsx`) — so no seeded listing needs one for this to be a real assertion. If that
  // ever changes, these two tests will start failing honestly rather than passing vacuously, which
  // is the right way round.
  test('virtual tour button visible when enabled', async ({ page, flags }) => {
    await flags.enable('videoListings');
    await page.goto(`/property/${BUY}`);
    await expect(page.getByText('Virtual Tour')).toBeVisible();
  });

  test('virtual tour button hidden when disabled', async ({ page, flags }) => {
    await flags.disable('videoListings');
    await page.goto(`/property/${BUY}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Virtual Tour')).toBeHidden();
  });
});

// ─────────────── IN-APP MESSAGING ───────────────

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

// ─────────────── SAVED LISTINGS ───────────────

// The mobile bottom nav also links to /saved, so a bare a[href="/saved"] locator is ambiguous under
// strict mode. These assertions are about the navbar, so scope them to it rather than loosening the
// match.
const navbarSaved = (page) => page.locator('nav:not(.pn-bottom-nav) a[href="/saved"]');

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

// ─────────────── ONLINE RENT PAYMENT ───────────────

test.describe('onlineRentPayment flag', () => {
  test('pay-rent shows the coming-soon page when disabled', async ({ page, flags, login }) => {
    await flags.disable('onlineRentPayment');
    await login.asTenant();
    await page.goto('/pay-rent');
    // Not a redirect — the route hosts an honest coming-soon page.
    await expect(page).toHaveURL(/\/pay-rent/);
    await expect(page.getByText('Rent payments are almost here')).toBeVisible();
  });

  test('pay-rent shows the live flow when enabled', async ({ page, flags, login }) => {
    await flags.enable('onlineRentPayment');
    // Priya holds the seeded active tenancy, so the real flow has an instalment to render.
    await login.asTenant();
    await page.goto('/pay-rent');
    await expect(page.getByRole('heading', { name: 'Pay rent', exact: true })).toBeVisible();
    await expect(page.getByText('Rent payments are almost here')).toHaveCount(0);
  });
});

// ─────────────── EVERYTHING OFF ───────────────

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
