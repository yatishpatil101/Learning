import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors } from '../../../helpers/listingForm.helper.js';
import { fillSociety } from '../../../helpers/places.js';
import { pickLocality } from '../../../helpers/locality.js';

const BANER_PIN = { lat: 18.5602, lng: 73.7861, locality: 'Baner', pincode: '411045' };
const uniqueName = (stem) => `${stem} ${Date.now().toString(36)}`;

async function gotoLocation(page) {
  await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
}

test('the society pick leads the location step and autofills safe fields; the current-location control and mobile map controls are wired', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoRequested = false;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition(success) {
        window.__geoRequested = true;
        success({ coords: { latitude: 18.5602, longitude: 73.7861 } });
      },
    } });
  });
  await gotoLocation(page);
  const { societyY, mapY } = await page.evaluate(() => ({
    societyY: document.querySelector('input[data-err="society"]').getBoundingClientRect().y,
    mapY: document.querySelector('.gm-style').getBoundingClientRect().y,
  }));
  expect(societyY).toBeLessThan(mapY);

  const NAME = uniqueName('Zz Skyline Heights');
  await fillSociety(page, NAME, BANER_PIN);
  await expect(page.locator('[data-err="locality"]')).toContainText('Baner');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411045');
  await expect(page.getByText(`Filled from ${NAME}`)).toBeVisible();
  await expect(page.getByText(/Location set:/i)).toBeVisible();

  await expect(page.getByRole('button', { name: /Use my current location/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Zoom in map/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Zoom out map/i })).toBeVisible();
  await page.getByRole('button', { name: /Use my current location/i }).click();
  await expect.poll(() => page.evaluate(() => window.__geoRequested)).toBe(true);
});

test('a society pick takes the society\'s own locality over a hand pick, but never overwrites an owner-entered pincode', async ({ page }) => {
  await gotoLocation(page);
  await pickLocality(page, 'Wakad');
  await page.locator('input[data-err="pincode"]').fill('411099');

  await fillSociety(page, uniqueName('Zz Skyline Owner'), BANER_PIN);
  await expect(page.locator('[data-err="locality"]')).toContainText('Baner');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411099');
});

test('picking society A and then society B in another locality moves the locality to B\'s', async ({ page }) => {
  await gotoLocation(page);
  await fillSociety(page, uniqueName('Zz Skyline Alpha'), BANER_PIN);
  await expect(page.locator('[data-err="locality"]')).toContainText('Baner');

  const wakad = { lat: 18.595 + Math.random() * 0.01, lng: 73.755 + Math.random() * 0.01, locality: 'Wakad', pincode: '411057' };
  await fillSociety(page, uniqueName('Zz Skyline Beta'), wakad);
  await expect(page.locator('[data-err="locality"]')).toContainText('Wakad');
  await expect(page.locator('[data-err="locality"]')).not.toContainText('Baner');
});

test('on a phone the locality dropdown is an anchored menu under the field, not the full-screen picker or a bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLocation(page);
  const trigger = page.locator('[data-err="locality"] .dz-dropdown__trigger').first();
  await trigger.click();
  const menu = page.locator('.dz-dropdown__menu.is-portal-open');
  await expect(menu).toBeVisible();
  await expect(menu).not.toHaveClass(/dz-dropdown__menu--(picker|sheet)/);
  await expect(menu.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const t = document.querySelector('[data-err="locality"] .dz-dropdown__trigger').getBoundingClientRect();
    const m = document.querySelector('.dz-dropdown__menu.is-portal-open').getBoundingClientRect();
    return { below: m.top >= t.bottom - 2, shorter: m.height < window.innerHeight * 0.9 };
  })).toEqual({ below: true, shorter: true });
});

test('a flat\'s society search is its map search: no area search bar, and the locate button sits on the society row, to its right', async ({ page }) => {
  await gotoLocation(page);
  await expect(page.locator('input[placeholder*="Search a locality"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search location' })).toHaveCount(0);
  await expect(page.getByText('Pin your property location')).toHaveCount(0);
  await expect(page.getByText('Pick your society above, or drag the pin to your building.')).toBeVisible();

  const { society, locate } = await page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    return {
      society: r(document.querySelector('input[data-err="society"]')),
      locate: r(document.querySelector('button[aria-label="Use my current location"]')),
    };
  });
  const overlapY = Math.min(society.y + society.height, locate.y + locate.height) - Math.max(society.y, locate.y);
  expect(overlapY, 'the locate button shares the society input\'s row').toBeGreaterThan(Math.min(society.height, locate.height) / 2);
  expect(locate.x, 'and sits to its right').toBeGreaterThanOrEqual(society.x + society.width);
});

test('land keeps the area search bar above the map, with the locate button inside it', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await page.locator('.radio-pill', { hasText: 'Sale' }).first().click();
  await page.locator('[data-err="propertyType"] .dz-dropdown__trigger').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: 'Open Plot' }).first().click();
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  for (const [key, label] of [['naStatus', 'Deemed NA'], ['otherRights', 'Clear']]) {
    await page.locator(`[data-err="${key}"] .dz-dropdown__trigger`).click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
  }
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });

  const search = page.locator('input[placeholder*="Search a locality"]');
  await expect(search).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search location' })).toBeVisible();
  await expect(page.getByText('Pin your property location')).toBeVisible();
  const above = await page.evaluate(() => document.querySelector('input[placeholder*="Search a locality"]').getBoundingClientRect().y
    < document.querySelector('.gm-style').getBoundingClientRect().y);
  expect(above, 'the search bar sits above the map').toBe(true);
  const locate = page.getByRole('button', { name: /Use my current location/i });
  await expect(locate).toBeVisible();
  await expect(page.locator('[data-err="location"]').filter({ has: locate }).filter({ has: search })).toHaveCount(1);
});
