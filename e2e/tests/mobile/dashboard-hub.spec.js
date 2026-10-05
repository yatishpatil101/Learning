import { test, expect } from '../../fixtures/live.js';
import { trackErrors } from '../../helpers/console.js';

// Seed consent because the bar overlays the same edge as the metrics sheet.
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch {}
  });
}

const statsGrid = (page) => page.getByTestId('dashboard-stats-grid');
const seeAll = (page) => page.getByTestId('see-all-metrics');

test.describe('Mobile dashboard hub', () => {
  test('renders four metrics inline as a 2x2 grid at 390px, logs no console errors, and keeps one row on desktop', async ({ page, login }) => {
    const errors = trackErrors(page);
    await withConsent(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await login.asBuyer();
    await page.goto('/dashboard');

    await test.step('renders four metrics inline as a 2x2 grid at 390px', async () => {
      // The split is a mobile affordance. A desktop user has the room for a 4-up row,
      // and an extra tap there would be a regression, not a simplification.
      await expect(statsGrid(page)).toBeVisible({ timeout: 15000 });
      await expect(statsGrid(page).locator('p.truncate:visible')).toHaveCount(4);
      await expect(seeAll(page)).toHaveCount(0);

      const box = await statsGrid(page).boundingBox();
      const tiles = await statsGrid(page).locator('button, .glass-card').evaluateAll((nodes) =>
        nodes.slice(0, 4).map((node) => {
          const rect = node.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      );
      expect(box.width).toBeLessThanOrEqual(390);
      for (const tile of tiles) expect(tile.height).toBeGreaterThanOrEqual(44);
    });

    expect(errors, 'the dashboard logs no console errors on a phone').toEqual([]);

    await test.step('desktop keeps all four metrics in one row and shows no See all', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/dashboard');

      await expect(statsGrid(page)).toBeVisible({ timeout: 15000 });
      await expect(statsGrid(page).locator('p.truncate:visible')).toHaveCount(4);
      const rows = await statsGrid(page).locator('p.truncate:visible').evaluateAll((nodes) =>
        [...new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top)))],
      );
      expect(rows).toHaveLength(1);
      await expect(seeAll(page)).toHaveCount(0);
    });
  });
});
