import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543210';

// Seed an authenticated + Aadhaar-verified owner, then advance to Step 2
// (Location & pricing) where the "Pin your property location" map lives.
async function gotoStep2(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now(),
    }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({
      verified: true, aadhaarMobile: mobile, at: Date.now(),
    }));
  }, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });

  // Step 1: minimum required fields, then continue.
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(250);
  const opt = page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' });
  if (await opt.count()) await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();

  await page.waitForSelector('.gm-style', { timeout: 20000 });
}

test('Step 2 map renders without JS errors', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoStep2(page);
  await expect(page.locator('.gm-style').first()).toBeVisible();
  expect(errors).toHaveLength(0);
});

test('map tiles actually load (Google Maps present)', async ({ page }) => {
  await gotoStep2(page);
  // Give tiles a moment to fetch, then assert Google tile images exist.
  await page.waitForFunction(
    () => document.querySelectorAll('.gm-style img').length > 0,
    null,
    { timeout: 15000 },
  );
  const tiles = await page.locator('.gm-style img').count();
  expect(tiles).toBeGreaterThan(0);
});

test('branded location pin is visible and draggable-ready', async ({ page }) => {
  await gotoStep2(page);
  await expect(page.locator('.lp-pin')).toHaveCount(1);
  // The pin renders inside a Google Advanced Marker element.
  await expect(page.locator('gmp-advanced-marker')).toHaveCount(1);
});

test('map chrome is hidden — no zoom / view / street-view controls', async ({ page }) => {
  await gotoStep2(page);
  // The picker is a clean pin-drop canvas: default Google controls are removed.
  await expect(page.locator('button[aria-label="Zoom in"]')).toHaveCount(0);
  await expect(page.locator('button[aria-label="Zoom out"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Show satellite imagery|Map|Satellite/i })).toHaveCount(0);
  await expect(page.locator('.gm-fullscreen-control')).toHaveCount(0);
});
