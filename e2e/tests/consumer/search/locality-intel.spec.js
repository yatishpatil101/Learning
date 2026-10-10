import { test, expect } from '../../../fixtures/live.js';
import { API } from '../../../helpers/liveAuth.js';
import { mintLocality, uniqueLocalityName } from '../../../helpers/locality.js';

const noindex = (page) => page.locator('meta[name="robots"][content="noindex"]');

test.describe('Locality guides — indexable before listings exist', () => {
  test('the /locality hub lists every guide on a map and in zone sections', async ({ page, consoleErrors }) => {
    await page.goto('/locality');
    await expect(page.getByRole('heading', { level: 1, name: 'Find your part of Pune' })).toBeVisible();
    await expect(noindex(page)).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/locality');
    await expect(page.getByRole('img', { name: /Map of Pune showing 12 localities/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'West Pune' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'East Pune' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Read guide/ })).toHaveCount(12);

    await page.getByRole('link', { name: /Kharadi.*Read guide/ }).click();
    await expect(page).toHaveURL(/\/locality\/kharadi$/);
    await page.getByRole('link', { name: 'All localities' }).click();
    await expect(page).toHaveURL(/\/locality$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/locality');
    expect(consoleErrors).toEqual([]);
  });

  test('a guided locality shows its guide, is indexable and links to the other guides', async ({ page, consoleErrors }) => {
    await page.goto('/locality/baner');
    await expect(page.getByRole('heading', { level: 1, name: 'Baner' })).toBeVisible();
    await expect(page.getByTestId('locality-guide').getByRole('heading', { name: 'Key facts' })).toBeVisible();
    await expect(noindex(page)).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/locality/baner');
    await expect(page).toHaveTitle(/^Baner, Pune: area guide/);

    await page.getByRole('navigation', { name: 'Other Pune localities' }).getByRole('link', { name: 'Kharadi' }).click();
    await expect(page).toHaveURL(/\/locality\/kharadi$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Kharadi' })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/locality/kharadi');
    expect(consoleErrors).toEqual([]);
  });

  test('the guide still renders, indexable, when the locality record is missing', async ({ page }) => {
    await page.route('**/localities/kothrud', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
    await page.goto('/locality/kothrud');
    await expect(page.getByRole('heading', { level: 1, name: 'Kothrud' })).toBeVisible();
    await expect(page.getByTestId('locality-guide')).toBeVisible();
    await expect(page.getByTestId('locality-unavailable')).toHaveCount(0);
    await expect(noindex(page)).toHaveCount(0);
    await expect(page.locator('a[href="/listings?loc=kothrud"]').first()).toBeVisible();
  });
});

test.describe('Locality page — stats only where the data is real', () => {
  test('a locality with three or more live listings shows its stats and is indexable', async ({ page, consoleErrors }) => {
    const all = await (await fetch(`${API}/localities`)).json();
    const busy = all.find((l) => l.indexable && (l.avgRent != null || l.ratePerSqft != null));
    test.skip(!busy, 'no locality in this database has three live listings yet');

    await page.goto(`/locality/${busy.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: busy.name })).toBeVisible();
    await expect(page.getByTestId('locality-stats')).toContainText(/₹\d/);
    await expect(page.getByTestId('locality-stats-pending')).toHaveCount(0);
    await expect(noindex(page)).toHaveCount(0);
    await expect(page.locator(`a[href="/listings?loc=${busy.slug}"]`).first()).toBeVisible();
    for (const gone of ['Price Trend', 'Livability', 'Connectivity & Landmarks']) {
      await expect(page.getByText(gone)).toHaveCount(0);
    }
    expect(consoleErrors).toEqual([]);
  });

  test('a freshly picked locality has no listings, so no stats and no indexing', async ({ page }) => {
    const minted = await mintLocality(uniqueLocalityName());
    await page.goto(`/locality/${minted.slug}`);

    await expect(page.getByRole('heading', { level: 1, name: minted.name })).toBeVisible();
    await expect(page.getByTestId('locality-stats-pending')).toBeVisible();
    await expect(page.getByTestId('locality-stats')).toHaveCount(0);
    await expect(noindex(page)).toHaveCount(1);
    await expect(page.locator(`a[href="/listings?loc=${minted.slug}"]`).first()).toBeVisible();
  });

  test('an unknown slug says so, with noindex, and offers the listings instead', async ({ page }) => {
    await page.goto('/locality/zz-no-such-locality');
    await expect(page.getByTestId('locality-unavailable')).toBeVisible();
    await expect(page.getByTestId('locality-stats')).toHaveCount(0);
    await expect(noindex(page)).toHaveCount(1);
    await expect(page.locator('[data-testid="locality-unavailable"] a[href="/listings"]')).toBeVisible();
  });
});