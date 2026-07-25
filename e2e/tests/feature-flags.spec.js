import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

/**
 * Helper: login as admin, navigate to settings → feature flags,
 * and toggle a specific app flag on or off.
 */
async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

/**
 * Set an app-level feature flag via localStorage directly.
 * This is faster and more reliable than navigating the admin UI for each toggle.
 */
async function setAppFlag(page, key, value) {
  await page.evaluate(({ key, value }) => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
    if (!db || !db.settings || !db.settings.flags) return;
    db.settings.flags[key] = value;
    localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
    window.dispatchEvent(new CustomEvent('punenest-settings-change'));
  }, { key, value });
}

/**
 * Login as a regular consumer user by setting localStorage directly.
 */
async function loginAsUser(page) {
  await page.goto(BASE);
  await page.evaluate(() => {
    const user = { name: 'Test User', mobile: '9876543210', role: 'buyer', loginAt: Date.now() };
    localStorage.setItem('puneNestUser', JSON.stringify(user));
  });
  await page.reload();
}

// ─────────────── MAP SEARCH FLAG ───────────────

test.describe('mapSearch flag', () => {
  test('map view button visible when enabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'mapSearch', true);
    await page.waitForTimeout(300);
    await expect(page.getByTitle('Map view')).toBeVisible();
  });

  test('map view button hidden when disabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'mapSearch', false);
    await page.waitForTimeout(300);
    await expect(page.getByTitle('Map view')).toBeHidden();
  });
});

// ─────────────── COMPARE PROPERTIES FLAG ───────────────

test.describe('compareProperties flag', () => {
  test('compare control visible in property details when enabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'compareProperties', true);
    // Compare lives in the property details action bar, not on listing tiles.
    await page.locator('a[href^="/property/"]').first().click();
    await page.waitForURL('**/property/**');
    await expect(page.getByTitle('Add to Compare', { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('compare control hidden in property details when disabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'compareProperties', false);
    await page.locator('a[href^="/property/"]').first().click();
    await page.waitForURL('**/property/**');
    await page.waitForTimeout(500);
    await expect(page.getByTitle('Add to Compare')).toHaveCount(0);
    await expect(page.getByTitle('Remove from Compare')).toHaveCount(0);
  });

  test('compare route redirects to / when disabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'compareProperties', false);
    await page.goto(`${BASE}/compare`);
    await page.waitForURL(url => !url.toString().includes('/compare'));
    expect(page.url()).not.toContain('/compare');
  });
});

// ─────────────── SCHEDULE VISIT FLAG ───────────────

test.describe('scheduleVisit flag', () => {
  test('visit button visible on property page when enabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'scheduleVisit', true);
    // Navigate to first property
    await page.locator('a[href^="/property/"]').first().click();
    await page.waitForURL('**/property/**');
    await expect(page.getByRole('button', { name: /Visit/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('visit button hidden on property page when disabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'scheduleVisit', false);
    await page.locator('a[href^="/property/"]').first().click();
    await page.waitForURL('**/property/**');
    await page.waitForTimeout(500);
    // The Visit buttons (sidebar + mobile CTA) should be gone
    const visitButtons = page.locator('button:has-text("Visit"), a:has-text("Visit")').filter({ hasText: /^Visit$/ });
    await expect(visitButtons).toHaveCount(0);
  });

  test('schedule-visit route redirects when disabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'scheduleVisit', false);
    await loginAsUser(page);
    await page.goto(`${BASE}/schedule-visit?listing=1`);
    await page.waitForURL(url => !url.toString().includes('/schedule-visit'));
    expect(page.url()).not.toContain('/schedule-visit');
  });
});

// ─────────────── EMI CALCULATOR FLAG ───────────────

test.describe('emiCalculator flag', () => {
  test('EMI calculator link visible when enabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'emiCalculator', true);
    await page.locator('a[href^="/property/"]').first().click();
    await page.waitForURL('**/property/**');
    await expect(page.locator('a[href="/emi-calculator"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('EMI calculator link hidden when disabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'emiCalculator', false);
    await page.locator('a[href^="/property/"]').first().click();
    await page.waitForURL('**/property/**');
    await page.waitForTimeout(500);
    await expect(page.locator('a[href="/emi-calculator"]')).toHaveCount(0);
  });

  test('emi-calculator route redirects when disabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'emiCalculator', false);
    await page.goto(`${BASE}/emi-calculator`);
    await page.waitForURL(url => !url.toString().includes('/emi-calculator'));
    expect(page.url()).not.toContain('/emi-calculator');
  });
});

// ─────────────── REVIEWS FLAG ───────────────

test.describe('reviewsEnabled flag', () => {
  test('reviews section visible on property page when enabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'reviewsEnabled', true);
    await page.locator('a[href^="/property/"]').first().click();
    await page.waitForURL('**/property/**');
    // Reviews live in the "Amenities & Society" tab.
    await page.getByRole('tab', { name: /Amenities & Society/i }).click();
    await expect(page.getByText(/review/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('reviews section hidden on property page when disabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'reviewsEnabled', false);
    await page.locator('a[href^="/property/"]').first().click();
    await page.waitForURL('**/property/**');
    // Open the tab that would host reviews, then confirm none render.
    await page.getByRole('tab', { name: /Amenities & Society/i }).click();
    await page.waitForTimeout(500);
    // The "Ratings & Reviews" heading should not exist
    await expect(page.locator('h2:has-text("Reviews")')).toHaveCount(0);
  });
});

// ─────────────── VIDEO LISTINGS FLAG ───────────────

test.describe('videoListings flag', () => {
  test('virtual tour button visible when enabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'videoListings', true);
    await page.locator('a[href^="/property/"]').first().click();
    await page.waitForURL('**/property/**');
    await expect(page.getByText('Virtual Tour')).toBeVisible({ timeout: 5000 });
  });

  test('virtual tour button hidden when disabled', async ({ page }) => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await setAppFlag(page, 'videoListings', false);
    await page.locator('a[href^="/property/"]').first().click();
    await page.waitForURL('**/property/**');
    await page.waitForTimeout(500);
    await expect(page.getByText('Virtual Tour')).toBeHidden();
  });
});

// ─────────────── IN-APP MESSAGING FLAG ───────────────

test.describe('inAppMessaging flag', () => {
  test('messages link visible in navbar when enabled and logged in', async ({ page }) => {
    await loginAsUser(page);
    await setAppFlag(page, 'inAppMessaging', true);
    await page.waitForTimeout(300);
    await expect(page.locator('a[href="/messages"]')).toBeVisible({ timeout: 5000 });
  });

  test('messages link hidden in navbar when disabled', async ({ page }) => {
    await loginAsUser(page);
    await setAppFlag(page, 'inAppMessaging', false);
    await page.waitForTimeout(300);
    await expect(page.locator('a[href="/messages"]')).toBeHidden();
  });

  test('messages route redirects when disabled', async ({ page }) => {
    await loginAsUser(page);
    await setAppFlag(page, 'inAppMessaging', false);
    await page.goto(`${BASE}/messages`);
    await page.waitForURL(url => !url.toString().includes('/messages'));
    expect(page.url()).not.toContain('/messages');
  });
});

// ─────────────── SAVED LISTINGS FLAG ───────────────

test.describe('savedListings flag', () => {
  test('saved link visible in navbar when enabled and logged in', async ({ page }) => {
    await loginAsUser(page);
    await setAppFlag(page, 'savedListings', true);
    await page.waitForTimeout(300);
    await expect(page.locator('a[href="/saved"]')).toBeVisible({ timeout: 5000 });
  });

  test('saved link hidden in navbar when disabled', async ({ page }) => {
    await loginAsUser(page);
    await setAppFlag(page, 'savedListings', false);
    await page.waitForTimeout(300);
    await expect(page.locator('a[href="/saved"]')).toBeHidden();
  });

  test('saved route redirects when disabled', async ({ page }) => {
    await loginAsUser(page);
    await setAppFlag(page, 'savedListings', false);
    await page.goto(`${BASE}/saved`);
    await page.waitForURL(url => !url.toString().includes('/saved'));
    expect(page.url()).not.toContain('/saved');
  });
});

// ─────────────── ONLINE RENT PAYMENT FLAG ───────────────

test.describe('onlineRentPayment flag', () => {
  test('pay-rent shows the coming-soon page when disabled', async ({ page }) => {
    await loginAsUser(page);
    await setAppFlag(page, 'onlineRentPayment', false);
    await page.goto(`${BASE}/pay-rent`);
    // No longer redirects to home — the route now hosts an honest coming-soon page.
    await expect(page).toHaveURL(/\/pay-rent/);
    await expect(page.getByText('Rent payments are almost here')).toBeVisible({ timeout: 5000 });
  });

  test('pay-rent shows the live flow when enabled', async ({ page }) => {
    await loginAsUser(page);
    await setAppFlag(page, 'onlineRentPayment', true);
    await page.goto(`${BASE}/pay-rent`);
    // Coming-soon hero must be gone; the real "Pay rent" heading renders.
    await expect(page.getByText('Rent payments are almost here')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pay rent', exact: true })).toBeVisible({ timeout: 5000 });
  });
});

// ─────────────── NO JS ERRORS ───────────────

test('no page errors on listings page with all flags disabled', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${BASE}/listings?deal=buy`);

  // Disable all flags
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v1'));
    if (!db || !db.settings || !db.settings.flags) return;
    Object.keys(db.settings.flags).forEach(k => { db.settings.flags[k] = false; });
    localStorage.setItem('puneNestDB_v1', JSON.stringify(db));
    window.dispatchEvent(new CustomEvent('punenest-settings-change'));
  });
  await page.waitForTimeout(500);

  // Page still renders without errors
  await expect(page.getByText(/properties/i).first()).toBeVisible({ timeout: 5000 });
  expect(errors).toHaveLength(0);
});

test('no page errors on property page with all flags disabled', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${BASE}/listings?deal=buy`);
  await page.locator('a[href^="/property/"]').first().click();
  await page.waitForURL('**/property/**');

  // Disable all flags
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v1'));
    if (!db || !db.settings || !db.settings.flags) return;
    Object.keys(db.settings.flags).forEach(k => { db.settings.flags[k] = false; });
    localStorage.setItem('puneNestDB_v1', JSON.stringify(db));
    window.dispatchEvent(new CustomEvent('punenest-settings-change'));
  });
  await page.waitForTimeout(500);

  // Page still renders without errors
  await expect(page.locator('#main-content').first()).toBeVisible({ timeout: 5000 });
  expect(errors).toHaveLength(0);
});
