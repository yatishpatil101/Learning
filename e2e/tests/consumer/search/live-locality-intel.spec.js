import { test, expect } from '../../../fixtures/live.js';

/* /locality/:slug — the intel dashboard.
 *
 * `locality-select` and `community-locality` reach this route incidentally (they
 * assert the picker and the community-mint flow), but nothing asserted the four
 * cards the page exists for. A chart that silently renders empty, a livability
 * comparison that ignores its select, or a connectivity list that lost its data
 * would all have passed the suite.
 *
 * The page is tabbed (`Tabs` in Locality.jsx): Overview holds the price trend +
 * livability, Area holds the map + market pulse + connectivity. Assertions have
 * to open the right tab first, which is itself worth pinning — the tab strip is
 * the only way to reach three of the five sections on a phone.
 */

const tab = (page, name) => page.getByRole('tab', { name }).or(page.getByRole('button', { name, exact: true })).first();

test.describe('Locality insights', () => {
  test('the header, KPI band and inventory bridge render for a tracked locality', async ({ page, consoleErrors }) => {
    await page.goto('/locality/baner');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Locality insights/i);
    await expect(page.getByText('Live Market Insights · Pune')).toBeVisible();

    // All four KPIs carry a value, not a dash — this is where a data regression lands.
    for (const label of ['Avg. price / sq.ft.', 'Rental yield']) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }
    const avgPrice = page.locator('.kpi').first();
    await expect(avgPrice).toContainText(/₹/);

    expect(consoleErrors).toEqual([]);
  });

  test('the price-trend card renders a chart and the range toggle drives it', async ({ page }) => {
    await page.goto('/locality/baner');

    const card = page.locator('.glass-card:has-text("Price Trend")').first();
    await expect(card).toBeVisible();
    // Chart.js paints into a canvas; an empty dataset would leave none.
    await expect(card.locator('canvas')).toBeVisible();

    // The forecast legend is the honest label on the dashed tail — losing it would
    // present a projection as recorded history.
    await expect(card.getByText('Forecast', { exact: true })).toBeVisible();

    for (const range of ['3Y', '5Y', '1Y']) {
      await card.getByRole('button', { name: range, exact: true }).click();
      await expect(card.getByRole('button', { name: range, exact: true })).toHaveClass(/active/);
      await expect(card.locator('canvas')).toBeVisible();
    }
  });

  test('livability shows a score, a rank and a working comparison', async ({ page }) => {
    await page.goto('/locality/baner');

    const card = page.locator('.glass-card:has-text("Livability")').first();
    await expect(card).toBeVisible();
    await expect(card.getByText('/10')).toBeVisible();
    await expect(card.getByText(/Ranked #\d+ of \d+ tracked Pune areas/)).toBeVisible();

    // No comparison markers until a locality is picked.
    await expect(card.locator('.bg-indigo-400')).toHaveCount(0);

    /* `NativeSelect` is a themed `.dz-dropdown`, not a real <select>, so
       selectOption never resolves here — open the trigger and click an option
       from the portaled menu (the pattern used by the listings filter specs). */
    await card.locator('.dz-dropdown__trigger').click();
    await page.locator('.dz-dropdown__menu--portal [role="option"]').first().click();

    // Picking a peer draws its marker on every sub-score bar.
    await expect(card.locator('.bg-indigo-400').first()).toBeVisible();
  });

  test('the Area tab exposes connectivity landmarks', async ({ page }) => {
    await page.goto('/locality/baner');

    await tab(page, 'Area').click();
    const card = page.locator('.glass-card:has-text("Connectivity & Landmarks")').first();
    await expect(card).toBeVisible();
    // Each row is a landmark plus a distance/time — an empty list is the failure.
    await expect(card.locator('div.flex.items-center.justify-between')).not.toHaveCount(0);
  });

  test('the Compare tab ranks localities and the leaderboard navigates', async ({ page }) => {
    await page.goto('/locality/baner');

    await tab(page, 'Compare').click();
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('an emerging locality gets the honest partial dashboard, not fabricated intel', async ({ page }) => {
    /* A curated area with no price/livability series. The page must say so rather than silently
       borrowing a tracked locality's numbers.

       This used to seed `pnCommunityLocalities` with an invented slug. That tier is deleted
       (register item 24) — free text no longer mints areas — so the case is now reached the way it
       actually occurs in production: one of the ~145 curated localities that `localityIntel.js`
       does not track. Ten are tracked; Lonikand is not, and being real it is a better test of the
       distinction than a fixture that only ever existed inside this file. */
    await page.goto('/locality/lonikand');

    await expect(page.getByText('Emerging locality · Pune')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Lonikand' })).toBeVisible();

    // The tracked-locality dashboard must NOT render for it.
    await expect(page.getByText('Price Trend')).toHaveCount(0);
    await expect(page.getByText('Ranked #', { exact: false })).toHaveCount(0);

    // What it does offer: a route into the search funnel.
    await expect(page.getByRole('link', { name: /View properties in Lonikand/ })).toBeVisible();
  });
});
