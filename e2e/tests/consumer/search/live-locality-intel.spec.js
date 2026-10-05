import { test, expect } from '../../../fixtures/live.js';

/* /locality/:slug — the intel dashboard.
 *
 * A chart that silently renders empty, a livability comparison that ignores its select, or a
 * connectivity list that lost its data must all fail here.
 *
 * The page is tabbed (`Tabs` in Locality.jsx): Overview holds the price trend +
 * livability, Area holds the map + market pulse + connectivity. Assertions have
 * to open the right tab first, which is itself worth pinning — the tab strip is
 * the only way to reach three of the five sections on a phone.
 */

const tab = (page, name) => page.getByRole('tab', { name }).or(page.getByRole('button', { name, exact: true })).first();

/* Chart.js repaints with an animation, so a screenshot is only comparable once two consecutive
   frames agree. */
async function settledShot(locator) {
  let last = await locator.screenshot();
  await expect.poll(async () => {
    const next = await locator.screenshot();
    const same = next.equals(last);
    last = next;
    return same;
  }, { timeout: 8000 }).toBe(true);
  return last;
}

test.describe('Locality insights', () => {
  test('a tracked locality shows its KPIs, price trend, livability, connectivity and a navigable ranking', async ({ page, consoleErrors }) => {
    test.slow();
    await page.goto('/locality/baner');

    await test.step('the header, KPI band and inventory bridge render for a tracked locality', async () => {
      await expect(page.getByRole('heading', { level: 1 })).toContainText(/Locality insights/i);
      await expect(page.getByText('Live Market Insights · Pune')).toBeVisible();

      // All four KPIs carry a value, not a dash — this is where a data regression lands.
      for (const label of ['Avg. price / sq.ft.', 'Rental yield']) {
        await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
      }
      const kpis = page.locator('.kpi');
      await expect(kpis).toHaveCount(4);
      for (let i = 0; i < 4; i += 1) {
        await expect(kpis.nth(i)).toContainText(/\d/);
      }
      await expect(kpis.first()).toContainText(/₹/);
    });

    await test.step('the price-trend card renders a chart and the range toggle drives it', async () => {
      const card = page.locator('.glass-card:has-text("Price Trend")').first();
      await expect(card).toBeVisible();
      // Chart.js paints into a canvas; an empty dataset would leave none.
      await expect(card.locator('canvas')).toBeVisible();

      // The forecast legend is the honest label on the dashed tail — losing it would
      // present a projection as recorded history.
      await expect(card.getByText('Forecast', { exact: true })).toBeVisible();

      const shots = {};
      for (const range of ['1Y', '3Y', '5Y']) {
        await card.getByRole('button', { name: range, exact: true }).click();
        await expect(card.getByRole('button', { name: range, exact: true })).toHaveClass(/active/);
        await expect(card.locator('canvas')).toBeVisible();
        shots[range] = await settledShot(card.locator('canvas'));
      }
      // A toggle that only moves the highlight would repaint the same series three times.
      expect(shots['3Y'].equals(shots['1Y']), '3Y repainted the 1Y series').toBe(false);
      expect(shots['5Y'].equals(shots['3Y']), '5Y repainted the 3Y series').toBe(false);
    });

    await test.step('livability shows a score, a rank and a working comparison', async () => {
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

    await test.step('the Area tab exposes connectivity landmarks', async () => {
      await tab(page, 'Area').click();
      const card = page.locator('.glass-card:has-text("Connectivity & Landmarks")').first();
      await expect(card).toBeVisible();
      // Each row is a landmark plus a distance/time — an empty list is the failure.
      await expect(card.locator('div.flex.items-center.justify-between')).not.toHaveCount(0);
    });

    await test.step('the Compare tab ranks localities and the leaderboard navigates', async () => {
      await tab(page, 'Compare').click();
      await expect(page.locator('canvas').first()).toBeVisible();

      const rows = page.locator('.lb-row');
      expect(await rows.count(), 'the leaderboard ranks more than one locality').toBeGreaterThan(1);
      // Default order is price, dearest first.
      const prices = (await rows.locator('td:nth-child(3)').allInnerTexts())
        .map((t) => Number(t.replace(/[^\d]/g, '')));
      expect(prices.every((v) => v > 0), `unparsed prices: ${prices}`).toBe(true);
      expect(prices, 'rows are not ranked by price').toEqual([...prices].sort((a, b) => b - a));

      const active = rows.filter({ has: page.locator('td', { hasText: /^Baner$/ }) });
      await expect(active).toHaveClass(/active/);
      const other = rows.filter({ hasNot: page.locator('td', { hasText: /^Baner$/ }) }).first();
      const otherName = (await other.locator('td:nth-child(2)').innerText()).trim();
      await other.click();
      await expect(rows.filter({ has: page.locator('td', { hasText: new RegExp(`^${otherName}$`) }) })).toHaveClass(/active/);
      await expect(active).not.toHaveClass(/active/);
    });

    expect(consoleErrors).toEqual([]);
  });

  test('an emerging locality gets the honest partial dashboard, not fabricated intel', async ({ page }) => {
    /* A curated area with no price/livability series. The page must say so rather than silently
       borrowing a tracked locality's numbers. Reached the way it occurs in production: one of the
       ~145 curated localities that `localityIntel.js` does not track (ten are; Lonikand is not). */
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