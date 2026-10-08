import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';
import { stubGooglePlaces } from '../../../helpers/places.js';

/* Listings → Localities is a plain search bar: typed text never becomes a filter, only a picked suggestion does (a removable chip + `loc` slug).
   Google empty falls back to `/localities/search`; a Google pick is resolved server-side. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

async function openLocalities(page, stub) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings`);
  const group = page.locator('aside .filter-group:has(button.fg-header:has-text("Localities"))').first();
  await group.waitFor({ timeout: 15000 });
  await stubGooglePlaces(page, stub);
  return { group, search: group.getByRole('combobox', { name: 'Localities' }) };
}

test('a saved locality is picked from the search bar, shown as a chip and removable', async ({ page }) => {
  const errors = trackErrors(page);
  const { group, search } = await openLocalities(page, { empty: true });
  await expect(group.getByRole('listbox')).toHaveCount(0);

  await search.fill('Baner');
  const option = group.getByRole('option', { name: /^Baner/ }).first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await expect(group.getByRole('img', { name: 'Powered by Google' }), 'saved rows are not Google results').toHaveCount(0);
  await option.click();

  const chip = group.getByRole('button', { name: /Remove Baner/i });
  await expect(chip).toBeVisible();
  await expect(search, 'the bar clears for the next locality').toHaveValue('');
  await expect(page).toHaveURL(/[?&]loc=[^&]*baner/);

  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]loc=/);
  expect(errors).toEqual([]);
});

test('a Google pick is resolved to its locality row before it filters', async ({ page }) => {
  const errors = trackErrors(page);
  const { group, search } = await openLocalities(page, {
    lat: 18.5975, lng: 73.7701, locality: 'Wakad', types: ['sublocality_level_1', 'sublocality', 'political'],
  });

  await search.fill('Wakad');
  const option = group.getByRole('option', { name: /^Wakad/ }).first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await expect(group.getByRole('img', { name: 'Powered by Google' })).toBeVisible();
  const resolved = page.waitForResponse((r) => r.url().includes('/localities/resolve') && r.request().method() === 'POST');
  await option.click();
  expect((await resolved).ok()).toBe(true);

  await expect(group.getByRole('button', { name: /Remove Wakad/i })).toBeVisible();
  await expect(page).toHaveURL(/[?&]loc=[^&]*wakad/);
  expect(errors).toEqual([]);
});
