import { test, expect } from '@playwright/test';
import { openFlatmates, setBudget } from '../../../helpers/app.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SEARCH = /Try: girl in baner/i;

const param = (page, key) => new URL(page.url()).searchParams.get(key);

const expectParam = (page, key, value) =>
  expect.poll(() => param(page, key), { timeout: 5000 }).toBe(value);

const openFilters = async (page) => {
  const toggle = page.locator('button[aria-controls="sf-desktop-filters"]');
  await expect(toggle).toBeVisible({ timeout: 10000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.locator('#sf-desktop-filters')).toBeVisible();
};

test('writes flatmate filters to the URL and restores them after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 820 });
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  await page.getByPlaceholder(SEARCH).fill('baner');
  await expectParam(page, 'q', 'baner');

  await openFilters(page);
  await page.getByRole('button', { name: 'Non-smoker', exact: true }).click();
  await expectParam(page, 'habits', 'Non-smoker');

  await setBudget(page, 12000);
  await expectParam(page, 'budget', '0-12000');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByPlaceholder(SEARCH)).toHaveValue('baner');
  await openFilters(page);
  await expect(page.getByRole('button', { name: 'Non-smoker', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.rng input[type="range"]:visible').nth(1)).toHaveValue('12000');
});

test('restores the previous flatmate filter state on Back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 820 });
  await openFlatmates(page, '?view=flatmates');
  await openFilters(page);

  await page.getByRole('button', { name: 'Non-smoker', exact: true }).click();
  await expectParam(page, 'habits', 'Non-smoker');

  await openFilters(page);
  await page.getByRole('button', { name: 'Veg', exact: true }).click();
  await expectParam(page, 'habits', 'Non-smoker,Vegetarian');

  await page.goBack();
  await expectParam(page, 'habits', 'Non-smoker');
  await openFilters(page);
  await expect(page.getByRole('button', { name: 'Non-smoker', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Veg', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('does not overwrite in-progress search text when the URL echo returns', async ({ page }) => {
  await openFlatmates(page, '?view=flatmates');

  const search = page.getByPlaceholder(SEARCH);
  await search.fill('baner ');
  await expectParam(page, 'q', 'baner ');
  await expect(search).toHaveValue('baner ');
});
