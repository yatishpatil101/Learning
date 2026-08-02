import { test, expect } from '../fixtures/base.js';

// Desktop coverage for the consumer Saved page (/saved).
// Behaviour verified from: pages/consumer/Saved.jsx, lib/store/notifications.js
// (pnSavedProps:<mobile>), lib/mockApi/properties.js (listProperties), App.jsx
// (AppFlagRoute flag="savedListings"), and en/compare-saved.json labels.
//
// An existing mobile-inbox-saved.spec.js covers the ≤767px layout only; this
// spec exercises the desktop surface: tabs, cards, remove/unsave, the
// create-alert (bell-plus) action and the empty state.

// Canonical buyer mobile (helpers/seed.js USERS.buyer) — saved props are keyed by it.
const BUYER_MOBILE = '9876500001';

// Approved demo listings from src/data/db.json (deal-confirmed via node inspection):
//   buy:  P5100, P5101   rent: P5000, P5006
const BUY_IDS = ['P5100', 'P5101'];
const RENT_IDS = ['P5000', 'P5006'];

// Dismiss the global cookie-consent dialog so it never overlays the tab/card buttons.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

// Seed hearted property ids into the buyer's pnSavedProps store before boot.
async function seedSavedProps(page, ids) {
  await page.addInitScript((list) => {
    localStorage.setItem('pnSavedProps:9876500001', JSON.stringify(list));
  }, ids);
}

test.describe('Saved properties — desktop', () => {
  test('a signed-out visitor gets the on-device shortlist and a sign-in prompt', async ({ page }) => {
    // /saved is no longer behind ProtectedRoute: saves are written to localStorage
    // by Reels/Compare/the map panel while signed out, so the page renders and
    // prompts instead of redirecting.
    await page.goto('/saved');
    await expect(page).not.toHaveURL(/\/signin/);
    await expect(page.getByRole('heading', { name: 'Saved properties', exact: true })).toBeVisible();
    await expect(page.getByText('Saved on this device')).toBeVisible();
    // Scoped to the prompt: the navbar has its own "Sign In" link.
    await expect(page.locator('a[href="/signin?reason=saved&next=%2Fsaved"]')).toBeVisible();
  });

  test('the sign-in prompt is gone once authenticated', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/saved');
    await expect(page.getByText('Saved on this device')).toHaveCount(0);
  });

  test('renders the category tabs and the saved cards for the active tab', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await seedSavedProps(page, [...BUY_IDS, ...RENT_IDS]);
    await page.goto('/saved');

    await expect(page.getByRole('heading', { name: 'Saved properties', exact: true })).toBeVisible();

    // Three category tabs: For Sale / For Rent / Flatmates & Rooms.
    const tabs = page.locator('.saved-tabs .saved-tab');
    await expect(tabs).toHaveCount(3);
    await expect(page.locator('.saved-tabs')).toContainText('For Sale');
    await expect(page.locator('.saved-tabs')).toContainText('For Rent');
    await expect(page.locator('.saved-tabs')).toContainText('Flatmates & Rooms');

    // Default tab is "For Sale" — both seeded buy listings resolve into cards.
    await expect(page.locator('.property-card')).toHaveCount(BUY_IDS.length);
    await expect(page.getByRole('heading', { name: 'Residential Open Plot in Wagholi' })).toBeVisible();
  });

  test('switching to For Rent shows the rented shortlist', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await seedSavedProps(page, [...BUY_IDS, ...RENT_IDS]);
    await page.goto('/saved');

    await page.getByRole('button', { name: /For Rent/ }).click();
    await expect(page.locator('.property-card')).toHaveCount(RENT_IDS.length);
    await expect(page.getByRole('heading', { name: '4 BHK Villa in Magarpatta' })).toBeVisible();
  });

  test('remove/unsave drops a card and unsaves it in the store', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await seedSavedProps(page, BUY_IDS);
    await page.goto('/saved');

    await expect(page.locator('.property-card')).toHaveCount(2);
    // Each buy card exposes an explicit "Remove from saved" action.
    await page.getByRole('button', { name: 'Remove from saved' }).first().click();

    // The card animates out (~400ms) then the grid settles at one card.
    await expect(page.locator('.property-card')).toHaveCount(1);
    // The unsave is persisted back to pnSavedProps (one id removed).
    const remaining = await page.evaluate(
      (m) => JSON.parse(localStorage.getItem(`pnSavedProps:${m}`) || '[]'),
      BUYER_MOBILE,
    );
    expect(remaining).toHaveLength(1);
  });

  test('the bell-plus action turns a saved home into a saved-search alert', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await seedSavedProps(page, BUY_IDS);
    await page.goto('/saved');

    await expect(page.locator('.property-card').first()).toBeVisible();
    await page.getByRole('button', { name: 'Create alert for similar properties' }).first().click();

    // Confirmation toast + a persisted saved search (pnSavedSearches:<mobile>).
    await expect(page.getByText(/Alert created/)).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate((m) => JSON.parse(localStorage.getItem(`pnSavedSearches:${m}`) || '[]').length, BUYER_MOBILE),
      )
      .toBeGreaterThan(0);
  });

  test('shows the empty state when the buyer has nothing saved', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/saved');

    await expect(page.getByRole('heading', { name: 'No saved properties yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Browse Properties/ })).toBeVisible();
    // No category tabs render while empty.
    await expect(page.locator('.saved-tabs .saved-tab')).toHaveCount(0);
  });

  test('loads the saved page with no real console errors', async ({ page, login, consoleErrors }) => {
    await login.asBuyer();
    await seedConsent(page);
    await seedSavedProps(page, [...BUY_IDS, ...RENT_IDS]);
    await page.goto('/saved');
    await expect(page.getByRole('heading', { name: 'Saved properties', exact: true })).toBeVisible();
    await expect(page.locator('.property-card').first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
