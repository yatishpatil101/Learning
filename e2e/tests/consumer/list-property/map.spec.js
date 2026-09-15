/* No identity badge is granted: the wizard has no identity gate, and granting one here would
   quietly assert the opposite of what `live-no-gate` proves. */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

// Sign in as a real owner account, then advance to Step 2 (Location & pricing) where the
// "Pin your property location" map lives.
async function gotoStep2(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });

  // Step 1: minimum required fields, then continue.
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  /* `count()` does not retry, so guarding this click on it silently skips the choice against a
     portalled menu one frame from open (Select.jsx:178). Wait for the menu instead. */
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  const opt = page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' });
  await expect(opt).toHaveCount(1);
  await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();

  await page.waitForSelector('.gm-style', { timeout: 30000 });
  return mobile;
}

test('Step 2 map renders without JS errors', async ({ page, consoleErrors }) => {
  await gotoStep2(page);
  await expect(page.locator('.gm-style').first()).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
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
