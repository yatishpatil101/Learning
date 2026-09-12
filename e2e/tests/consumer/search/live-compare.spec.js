import { test, expect } from '../../../fixtures/live.js';

// The `compareProperties` flag is server state (`GET /flags`), so the `flags` fixture writes it via
// `PUT /admin/settings`; `draazyCompare` stays in localStorage because CompareContext really uses it.

// Two real, approved listings — both live rows in Postgres, not db.json fixtures.
const A = 'p5013'; // 1 BHK Flat, Baner (buy)
const B = 'p5121'; // 2 BHK Flat, Wakad (rent)

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

// Seed the CompareContext store before boot — the same state CompareToggleBar writes on "Compare".
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
    // Before the navigation: AppFlagRoute redirects a page that boots with the flag off.
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

  // Ungated, the picker's catalogue search pulled a 100-row page on every visit and every
  // add/remove, for a dialog most visitors never open.
  test('the picker search runs only once the sheet is opened', async ({ page }) => {
    await seedConsent(page);
    await seedCompare(page, [A]);

    const catalogueHits = [];
    page.on('request', (r) => {
      // The picker's search, not the per-id column reads (`/api/properties/<id>`).
      if (/\/api\/properties\?/.test(r.url())) catalogueHits.push(r.url());
    });

    await page.goto('/compare');
    await expect(page.locator(`a[href="/property/${A}"]`)).toBeVisible();
    expect(catalogueHits).toEqual([]);

    await page.getByRole('button', { name: 'Add Property' }).click();
    await expect(page.getByRole('heading', { name: 'Add a property to compare' })).toBeVisible();
    // Greater-than rather than exactly one: StrictMode mounts the route twice under the dev server.
    await expect.poll(() => catalogueHits.length).toBeGreaterThan(0);
  });

  // `pickable` starts null ("not answered yet"), so an uncaught rejection would sit on the loading
  // line forever, and answering `[]` would claim the catalogue is exhausted.
  test('a failed picker search says so instead of claiming there is nothing to add', async ({ page }) => {
    await seedConsent(page);
    await seedCompare(page, [A]);
    await page.goto('/compare');
    // Routed after the column read resolves, so only the picker's search is broken.
    await expect(page.locator(`a[href="/property/${A}"]`)).toBeVisible();
    await page.route('**/api/properties?**', (route) => route.abort('failed'));

    await page.getByRole('button', { name: 'Add Property' }).click();
    await expect(page.getByText('Could not load properties. Check your connection and try again.')).toBeVisible();
    await expect(page.getByText('No more properties to add.')).toHaveCount(0);
  });
});
