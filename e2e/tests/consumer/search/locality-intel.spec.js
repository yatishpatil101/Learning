import { test, expect } from '../../../fixtures/live.js';
import { API } from '../../../helpers/liveAuth.js';
import { mintLocality, uniqueLocalityName } from '../../../helpers/locality.js';

const noindex = (page) => page.locator('meta[name="robots"][content="noindex"]');

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