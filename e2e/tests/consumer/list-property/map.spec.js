/* No identity badge is granted: the wizard has no identity gate, and granting one here would
   quietly assert the opposite of what `live-no-gate` proves. */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors } from '../../../helpers/listingForm.helper.js';

// Sign in as a real owner account, then advance to the Location step where the
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
  await pickFloors(page);
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

/* 'Kothrud' is matched offline by `runMapSearch` against the locality table, so the placement needs
   no geocoder stub and the restored coordinates name their own source. */
test('a pin placed before a reload is still placed after it', async ({ page }) => {
  await gotoStep2(page);
  await page.locator('input[placeholder*="Search a locality"]').fill('Kothrud');
  await page.getByRole('button', { name: /Search location/i }).click();
  // No `^`: the icon leaves a leading space in the text node, and a regex match is not normalized.
  const confirmation = page.getByText(/Location set: /);
  await expect(confirmation).toBeVisible();
  const placed = await confirmation.textContent();

  /* A synchronization barrier, not the claim: the autosave is debounced and `evaluate` does not
     retry, so poll for the write rather than for a duration somebody timed the debounce at once. */
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem('dzDraft:list-property')))
    .toContain('"pinPlaced":true');

  await page.reload();
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  /* `useFormDraft` restores in a mount effect, so clicking straight through races the re-render and
     fails the button as "not stable". Wait on a restored value. */
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1050');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await expect(page.getByText(/Location set: /)).toHaveText(placed);

  /* The gate is the claim: a restored pin can be visible while the step still refuses to advance. The blank
     address's complaint proves validation ran rather than that the click did nothing. */
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.getByText('Enter the flat / unit number.')).toBeVisible();
  await expect(page.getByText(/never appears in their results/)).toHaveCount(0);
});
