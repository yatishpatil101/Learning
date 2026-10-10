import { test, expect } from '../../../fixtures/live.js';

// Page JSON-LD is prerendered at build time only (frontend/scripts/vite-plugin-route-heads.test.mjs asserts it).
test('/compare/nobroker is dated, and every NoBroker claim links to NoBroker', async ({ page }) => {
  await page.goto('/compare/nobroker', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('Draazy vs NoBroker: Plans and Fees Compared (Pune)');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/compare/nobroker');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Draazy vs NoBroker');
  await expect(page.getByTestId('compare-as-of')).toContainText("Facts as of October 2026, from NoBroker\u2019s published pages");
  await expect(page.getByTestId('compare-as-of').getByRole('link', { name: 'support@draazy.com' })).toHaveAttribute('href', 'mailto:support@draazy.com');

  const cells = page.getByTestId('compare-nobroker-cell');
  expect(await cells.count()).toBe(8);
  for (const cell of await cells.all()) {
    const hrefs = await cell.locator('a').evaluateAll((as) => as.map((a) => a.href));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^https:\/\/www\.nobroker\.in\//);
  }
  await expect(page.getByRole('heading', { name: 'When NoBroker may suit you better' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'When Draazy may suit you' })).toBeVisible();
  await expect(page.locator('dl dt')).toHaveCount(4);
});
