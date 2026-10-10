import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('a search superseded by a refinement never paints its late answer', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });

  let held = null;
  await page.route('**/api/properties?**', async (route) => {
    if (held) return route.fallback();
    held = route;
  });

  await page.goto(`${BASE}/listings?deal=rent`);
  await expect.poll(() => held, { timeout: 15000 }).not.toBeNull();

  const refined = page.waitForResponse((r) => /\/api\/properties\?/.test(r.url()) && r.ok());
  await page.locator('.lst-search-field').first().fill('2 bhk');
  await page.getByRole('button', { name: 'Smart search' }).first().click();
  await refined;

  await held.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ content: [], totalElements: 7777, totalPages: 1, verifiedElements: 0, unstatedElements: 0 }),
  });
  await page.waitForTimeout(500);

  await expect(page.locator('body')).not.toContainText(/7,?777/);
});