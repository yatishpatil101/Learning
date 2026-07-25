import { test, expect } from '../fixtures/base.js';

// Property comparison (/compare).
//
// Behaviour verified from: pages/consumer/Compare.jsx, context/CompareContext.jsx
// (localStorage key `puneNestCompare`, capped at 4), property/CompareToggleBar.jsx
// (the "Add to Compare" control on a property page), App.jsx (route is wrapped in
// AppFlagRoute flag="compareProperties" -> redirects to / when the flag is off),
// and i18n/locales/en/compare-saved.json for the visible labels.
//
// The feature flag defaults to enabled (flagEnabled returns true unless the flag is
// explicitly false), and the seed DB sets settings.flags.compareProperties = true.

// Two real, approved listings from src/data/db.json used to populate the table.
const A = 'P5013'; // 1 BHK Flat, Baner (buy)
const B = 'R7100'; // 2 BHK Flat, Wakad (rent)

// The global cookie-consent banner is also role="dialog"; seed consent so it never
// overlays the comparison surface.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

// Seed the CompareContext store before the app boots (the context reads this key on
// init). This is the same state CompareToggleBar writes when a user taps "Compare".
async function seedCompare(page, ids) {
  await page.addInitScript((list) => {
    localStorage.setItem('puneNestCompare', JSON.stringify(list));
  }, ids);
}

// Explicitly turn the compareProperties flag ON so the route is reachable regardless
// of seed state — mirrors the feature-flags spec pattern.
async function enableCompareFlag(page) {
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
    if (!db || !db.settings || !db.settings.flags) return;
    db.settings.flags.compareProperties = true;
    localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
    window.dispatchEvent(new CustomEvent('punenest-settings-change'));
  });
}

test.describe('Compare properties — /compare', () => {
  test('shows the empty state when nothing has been added', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/compare');
    await expect(page.getByRole('heading', { name: 'Compare properties' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No properties to compare' })).toBeVisible();
    await expect(page.getByText('Add properties from listings to see them side by side.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Browse Listings/i })).toBeVisible();
    // Reset / Export actions only exist once something is being compared.
    await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(0);
  });

  test('renders the comparison table for two seeded properties', async ({ page }) => {
    await seedConsent(page);
    await seedCompare(page, [A, B]);
    await page.goto('/compare');

    await expect(page.getByRole('heading', { name: 'Compare properties' })).toBeVisible();

    // Both property columns render with a working "View" deep-link back to the listing.
    await expect(page.locator(`a[href="/property/${A}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/property/${B}"]`)).toBeVisible();

    // Real comparison rows (labels come straight from compare-saved.json).
    await expect(page.getByText('Property Type', { exact: true })).toBeVisible();
    await expect(page.getByText('Configuration', { exact: true })).toBeVisible();
    await expect(page.getByText('Area (sq.ft.)', { exact: true })).toBeVisible();
    await expect(page.getByText('Price / sq.ft.', { exact: true })).toBeVisible();
    await expect(page.getByText('RERA Verified', { exact: true })).toBeVisible();
    await expect(page.getByText('Amenities', { exact: true })).toBeVisible();

    // Action bar appears now that there is something to compare.
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export PDF' })).toBeVisible();
  });

  test('removing a property drops its column but keeps the rest', async ({ page }) => {
    await seedConsent(page);
    await seedCompare(page, [A, B]);
    await page.goto('/compare');

    await expect(page.locator(`a[href="/property/${A}"]`)).toBeVisible();
    // Each column card carries a remove control titled "Remove <title> from comparison".
    await page.getByRole('button', { name: /Remove .* from comparison/i }).first().click();

    // One column is gone, the other survives, and the table still stands.
    await expect(page.locator(`a[href="/property/${A}"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="/property/${B}"]`)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No properties to compare' })).toHaveCount(0);
  });

  test('Reset clears everything and returns to the empty state', async ({ page }) => {
    await seedConsent(page);
    await seedCompare(page, [A, B]);
    await page.goto('/compare');

    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset' }).click();

    await expect(page.getByRole('heading', { name: 'No properties to compare' })).toBeVisible();
    await expect(page.locator(`a[href="/property/${A}"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="/property/${B}"]`)).toHaveCount(0);
  });

  test('a property can be added via the property-page compare toggle', async ({ page }) => {
    await seedConsent(page);
    await page.goto(`/property/${A}`);
    await enableCompareFlag(page);

    // The compare control lives in the property action bar (title toggles on click).
    const addBtn = page.getByTitle('Add to Compare', { exact: true });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();
    await expect(page.getByTitle('Remove from Compare', { exact: true })).toBeVisible();

    // The comparison surface now shows the property we just added.
    await page.goto('/compare');
    await expect(page.getByRole('heading', { name: 'Compare properties' })).toBeVisible();
    await expect(page.locator(`a[href="/property/${A}"]`)).toBeVisible();
  });

  test('the comparison table loads with no real console errors', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    await seedCompare(page, [A, B]);
    await page.goto('/compare');
    await expect(page.getByRole('heading', { name: 'Compare properties' })).toBeVisible();
    await expect(page.locator(`a[href="/property/${A}"]`)).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
