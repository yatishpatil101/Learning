// No identity badge is granted: the wizard has no identity gate — posting needs a mobile-verified
// account and nothing more — so granting one would assert a wall the product does not have.
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors } from '../../../helpers/listingForm.helper.js';

// Register a real account and sign it in over HTTP, so the flow renders straight into the form for
// a session the server recognises.
async function gotoForm(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

// The portalled menu is `opacity: 0; pointer-events: none` for one frame after opening, so waiting
// on `.is-portal-open` is what makes it genuinely interactive.
async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

// Fill a valid Details step for a flat and advance to Location.
async function toStep2Flat(page) {
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: 'Location', exact: true }).waitFor({ timeout: 10000 });
}

test('numeric fields strip letters, signs and extra dots as you type', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');
  const area = page.locator('input[data-err="carpetArea"]');
  // "-1a2.3.4" must reduce to a clean positive decimal with a single dot.
  await area.fill('-1a2.3.4');
  await expect(area).toHaveValue('12.34');
});

test('a zero or empty area cannot pass the Details step', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('0');
  await page.getByRole('button', { name: /Next Step/i }).click();
  // Rejected: we stay on Details — the map of the location step never renders — and the area
  // field is flagged.
  await expect(page.locator('.gm-style')).toHaveCount(0);
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveClass(/dz-invalid/);
});

test('an all-spaces society name is treated as empty and rejected', async ({ page }) => {
  await toStep2Flat(page);
  const society = page.locator('input[data-err="society"]');
  await society.fill('   ');
  // Leading whitespace is stripped at the source, so the field holds nothing.
  await expect(society).toHaveValue('');
});

test('pincode must be a real six-digit code, not 000000', async ({ page }) => {
  await toStep2Flat(page);
  await page.locator('[data-err="locality"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('000000');
  await page.getByRole('button', { name: /Next Step/i }).click();
  // Rejected: never reaches the pricing step; pincode is flagged.
  await expect(page.getByText('Price & terms')).toHaveCount(0);
  await expect(page.locator('input[data-err="pincode"]')).toHaveClass(/dz-invalid/);
});
