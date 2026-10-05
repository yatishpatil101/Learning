import { test, expect } from '@playwright/test';
import { seedConsent } from '../../helpers/liveAuth.js';

const menu = (page) => page.locator('.dz-dropdown__menu--portal.is-portal-open');
const rootVar = (page, name) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name);

async function settledBox(locator) {
  let prev = null;
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const same = prev && box && prev.y === box.y && prev.height === box.height;
    prev = box;
    return Boolean(same);
  }, { timeout: 5_000, message: 'the dropdown never stopped moving' }).toBe(true);
  return prev;
}

async function openLocalities(page) {
  await seedConsent(page);
  await page.goto('/listings');
  await page.locator('button.fixed.rounded-full', { hasText: /filter/i }).first().click();
  const group = page.locator('.filter-panel.open .filter-group:has(h4:has-text("Localities"))');
  await group.locator('.dz-dropdown__trigger').click();
  await expect(menu(page).locator('.dz-dropdown__search input')).toBeFocused();
  return menu(page);
}

test.describe('Searchable dropdowns on a phone', () => {
  test('open as a full-height picker with search first, not a bottom sheet the keyboard buries', async ({ page }) => {
    const picker = await openLocalities(page);
    await expect(picker).toHaveClass(/dz-dropdown__menu--picker/);
    const box = await settledBox(picker);
    const vh = await page.evaluate(() => window.innerHeight);

    expect(box.y, 'the picker starts near the top of the screen').toBeLessThan(vh * 0.1);
    expect(Math.abs(box.y + box.height - vh), 'with no keyboard it reaches the bottom').toBeLessThanOrEqual(1);

    const search = await picker.locator('.dz-dropdown__search').boundingBox();
    expect(search.y - box.y, 'search sits at the top of the picker').toBeLessThan(60);
  });

  test('carry their own way out beside the search box', async ({ page }) => {
    const picker = await openLocalities(page);
    const cancel = picker.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeInViewport();
    const tap = await cancel.boundingBox();
    expect(tap.height).toBeGreaterThanOrEqual(44 - 0.5);

    await cancel.click();
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator('.filter-panel.open'), 'only the picker closes, not the filter sheet under it').toHaveCount(1);
  });

  test('stop at the top edge of the keyboard', async ({ page }) => {
    const picker = await openLocalities(page);
    await settledBox(picker);
    expect(await rootVar(page, '--dz-vv-bottom'), 'the open picker must be tracking the viewport').toBe('0px');

    const keyboard = 320;
    await page.evaluate((kb) => document.documentElement.style.setProperty('--dz-vv-bottom', `${kb}px`), keyboard);
    const vh = await page.evaluate(() => window.innerHeight);
    const box = await picker.boundingBox();
    expect(Math.abs(box.y + box.height - (vh - keyboard))).toBeLessThanOrEqual(1);
    await expect(picker.locator('[role="option"]').nth(2), 'results stay visible above the keyboard').toBeInViewport();

    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    expect(await rootVar(page, '--dz-vv-bottom'), 'closing hands the root back clean').toBe('');
  });

  test('a short list without search stays a bottom sheet', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/listings');
    await page.locator('.dz-dd-sort .dz-dropdown__trigger').first().click();
    const sheet = menu(page);
    await expect(sheet).toHaveClass(/dz-dropdown__menu--sheet/);
    await expect(sheet).not.toHaveClass(/dz-dropdown__menu--picker/);
    await expect(sheet.locator('.dz-dropdown__search-close'), 'a sheet still closes by tapping the scrim').toHaveCount(0);
    const box = await settledBox(sheet);
    const vh = await page.evaluate(() => window.innerHeight);
    expect(Math.abs(box.y + box.height - vh)).toBeLessThanOrEqual(1);
    expect(box.y, 'a six-option sheet is not stretched to full height').toBeGreaterThan(vh * 0.2);

    const option = await sheet.getByRole('option').first().boundingBox();
    expect(option.height, 'a dropdown option is a real target, not a sliver').toBeGreaterThanOrEqual(44 - 0.5);
  });
});
