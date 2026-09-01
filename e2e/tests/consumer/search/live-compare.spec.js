import { test, expect } from '../../../fixtures/live.js';

// Property comparison (/compare).
//
// Behaviour verified from: pages/consumer/Compare.jsx, context/CompareContext.jsx
// (localStorage key `draazyCompare`, capped at 4), property/CompareToggleBar.jsx
// (the "Add to Compare" control on a property page), App.jsx (route is wrapped in
// AppFlagRoute flag="compareProperties" -> redirects to / when the flag is off),
// and i18n/locales/en/compare-saved.json for the visible labels.
//
// WHAT CHANGED IN THE MOVE TO LIVE. The mock ancestor turned the feature flag on by
// editing `settings.flags` inside `draazyDB_v5`. Under the live config `settings` is
// one of the VITE_API_DOMAINS, so the flag the app consults comes from `GET /flags` on
// the server and that localStorage write is read by nobody — a silent no-op dressed up
// as setup. Worse, it threw when the mock store was absent, which made the test's own
// pass depend on a store the live build has no reason to create. The `flags` fixture
// writes through `PUT /admin/settings` (the only writer) and restores the previous value
// on teardown even when the test fails, so a flag flipped here cannot leak into the
// specs that follow.
//
// `draazyCompare` stays in localStorage on purpose: CompareContext genuinely keeps the
// shortlist client-side, so seeding that key is a statement about the real storage the
// feature uses, not a substitute for a server the test is avoiding.

// Two real, approved listings — both live rows in Postgres, not db.json fixtures.
const A = 'p5013'; // 1 BHK Flat, Baner (buy)
const B = 'p5121'; // 2 BHK Flat, Wakad (rent) - seeded 2026-08-19

// The global cookie-consent banner is also role="dialog"; seed consent so it never
// overlays the comparison surface.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

// Seed the CompareContext store before the app boots (the context reads this key on
// init). This is the same state CompareToggleBar writes when a user taps "Compare".
async function seedCompare(page, ids) {
  await page.addInitScript((list) => {
    localStorage.setItem('draazyCompare', JSON.stringify(list));
  }, ids);
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

  test('a property can be added via the property-page compare toggle', async ({ page, flags }) => {
    // Before the navigation, not after: the route is wrapped in AppFlagRoute, so a page that
    // boots with the flag off has already been redirected to `/` by the time a later write
    // could matter.
    await flags.enable('compareProperties');
    await seedConsent(page);
    await page.goto(`/property/${A}`);

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
