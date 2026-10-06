import { test, expect } from '../../../fixtures/live.js';
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

async function seedCompare(page, ids) {
  await page.addInitScript((list) => {
    localStorage.setItem('draazyCompare', JSON.stringify(list));
  }, ids);
}

const rootOverflow = (page) => page.evaluate(() => getComputedStyle(document.documentElement).overflowY);

test.describe('Compare properties — /compare', () => {
  test('shows the empty state when nothing has been added', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/compare');
    await expect(page.getByRole('heading', { name: 'Compare properties' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No properties to compare' })).toBeVisible();
    await expect(page.getByText('Add properties from listings to see them side by side.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Browse Listings/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(0);
  });

  test('renders the comparison table for two seeded properties with no real console errors', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    await seedCompare(page, [A, B]);
    await page.goto('/compare');

    await expect(page.getByRole('heading', { name: 'Compare properties' })).toBeVisible();

    await expect(page.locator(`a[href="/property/${A}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/property/${B}"]`)).toBeVisible();

    await expect(page.getByText('Property Type', { exact: true })).toBeVisible();
    await expect(page.getByText('Configuration', { exact: true })).toBeVisible();
    // Plain "Area": a parcel is measured in acres or guntha, so the unit lives in each cell; the
    // row still quoting sq.ft. is the price one, suppressed for listings not measured in sq.ft.
    await expect(page.getByText('Area', { exact: true })).toBeVisible();
    await expect(page.getByText('Price / sq.ft.', { exact: true })).toBeVisible();
    await expect(page.getByText('RERA Verified', { exact: true })).toBeVisible();
    await expect(page.getByText('Amenities', { exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export PDF' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('removing a property drops its column but keeps the rest', async ({ page }) => {
    await seedConsent(page);
    await seedCompare(page, [A, B]);
    await page.goto('/compare');

    await expect(page.locator(`a[href="/property/${A}"]`)).toBeVisible();
    await page.getByRole('button', { name: /Remove .* from comparison/i }).first().click();

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

    const addBtn = page.getByTitle('Add to Compare', { exact: true });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();
    await expect(page.getByTitle('Remove from Compare', { exact: true })).toBeVisible();

    await page.goto('/compare');
    await expect(page.getByRole('heading', { name: 'Compare properties' })).toBeVisible();
    await expect(page.locator(`a[href="/property/${A}"]`)).toBeVisible();
  });

  test('listing cards carry only the save heart, never a compare toggle', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/listings?deal=buy');
    await expect(page.locator('.heart-btn').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /add to compare/i })).toHaveCount(0);
  });

  // Ungated, the picker's catalogue search pulls a 100-row page on every visit and every
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
  /* Without a `role` the picker is invisible to `isTopDialog`, and untrapped Tab escapes into the table. */
  test('the picker announces itself as a modal dialog while it holds the scroll lock, and keeps Tab inside itself', async ({ page }) => {
    await seedConsent(page);
    await seedCompare(page, [A]);
    await page.goto('/compare');
    await expect(page.locator(`a[href="/property/${A}"]`)).toBeVisible();
    expect(await rootOverflow(page)).not.toBe('hidden');

    await page.getByRole('button', { name: 'Add Property' }).click();
    const picker = page.getByRole('dialog', { name: 'Add a property to compare' });
    await expect(picker).toBeVisible();
    expect(await rootOverflow(page)).toBe('hidden');
    /* `aria-modal` claims the page behind is inert, so the keyboard has to have a way out of the
       claim: focus lands in the panel, Escape closes it, and the lock is released with it. */

    await expect(picker).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    expect(await rootOverflow(page)).not.toBe('hidden');

    await page.getByRole('button', { name: 'Add Property' }).click();
    await expect(picker).toBeVisible();
    // Far more presses than the panel has stops, so a leak shows up wherever the exit sits.
    for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab');
    await expect(picker.locator(':focus')).toHaveCount(1);
  });
});
