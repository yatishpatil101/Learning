// No identity badge is granted: the wizard has no identity gate, and granting one here would
// quietly assert the opposite of what `live-no-gate` proves.
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors, pickPossession } from '../../../helpers/listingForm.helper.js';

// Sign in as a real owner so the whole-place flow renders straight into the form.
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

async function toUploadsFlat(page) {
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: 'Location', exact: true }).waitFor({ timeout: 10000 });
  await page.locator('[data-err="locality"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Test Project');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  await page.locator('input[data-err="price"]').fill('5000000');
  await pickPossession(page);
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Photos & documents').waitFor({ timeout: 10000 });
}

test('Furniture: a user can add a custom item and remove it', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');

  // Furniture picker only appears once the place is (semi-)furnished.
  await page.getByText('Furnishing Status').locator('..').getByText('Furnished', { exact: true }).click();
  await expect(page.getByText("What's included?")).toBeVisible();

  const input = page.getByLabel('Add a custom furniture item');
  await input.fill('Study Table');
  await input.press('Enter');

  const custom = page.locator('.furn-tile[data-custom="true"]', { hasText: 'Study Table' });
  await expect(custom).toBeVisible();
  // Custom entries land already selected (checked) so they count toward the listing.
  await expect(custom).toHaveClass(/checked/);

  // Adding the same label again is a no-op (case-insensitive de-dupe).
  await input.fill('study table');
  await input.press('Enter');
  await expect(page.locator('.furn-tile', { hasText: 'Study Table' })).toHaveCount(1);

  // Typing a name we already offer just selects that predefined tile, not a duplicate custom one.
  await input.fill('AC');
  await input.press('Enter');
  await expect(page.locator('.furn-tile[data-custom="true"]')).toHaveCount(1);
  const acTile = page.locator('.furn-tile').filter({ has: page.getByText('AC', { exact: true }) });
  await expect(acTile).toHaveClass(/checked/);

  // Clicking a custom tile removes it entirely.
  await custom.click();
  await expect(page.locator('.furn-tile', { hasText: 'Study Table' })).toHaveCount(0);
});

test('Amenities: a user can add a custom amenity not in our list', async ({ page }) => {
  await toUploadsFlat(page);

  const input = page.getByLabel('Add a custom amenity');
  await input.fill('EV Charging');
  await input.press('Enter');

  const custom = page.locator('.furn-tile[data-custom="true"]', { hasText: 'EV Charging' });
  await expect(custom).toBeVisible();
  await expect(custom).toHaveClass(/checked/);

  // The commit gives explicit feedback so it never reads as "nothing happened".
  await expect(page.getByText('Added “EV Charging”')).toBeVisible();

  // Typing a name already in the list is de-duped, and the user is told why.
  await input.fill('EV Charging');
  await page.getByRole('button', { name: /^Add$/ }).click();
  await expect(page.getByText('“EV Charging” is already in your list')).toBeVisible();
  await expect(page.locator('.furn-tile[data-custom="true"]', { hasText: 'EV Charging' })).toHaveCount(1);

  // The add input is width-capped, not a full-page bar (design rule).
  const box = await input.boundingBox();
  const form = await page.locator('.lp-step').first().boundingBox();
  expect(box.width).toBeLessThan(form.width * 0.7);

  await custom.click();
  await expect(page.locator('.furn-tile', { hasText: 'EV Charging' })).toHaveCount(0);
});
