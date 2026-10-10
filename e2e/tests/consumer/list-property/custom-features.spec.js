// No identity badge is granted: the wizard has no identity gate, and granting one here would
// quietly assert the opposite of what `no-gate` proves.
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors, pickPossession } from '../../../helpers/listingForm.helper.js';
import { fillSociety } from '../../../helpers/places.js';
import { pickLocality } from '../../../helpers/locality.js';
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
  await pickLocality(page, 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await fillSociety(page, 'Test Project');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  await page.locator('input[data-err="price"]').fill('5000000');
  await pickPossession(page);
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Photos & description').waitFor({ timeout: 10000 });
}

test('Furniture picker: titled by what the owner declares, tiles are keyboard-operable, and a custom item can be added and removed', async ({ page }) => {
  test.slow();
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');
  const picker = page.getByTestId('in-flat-features');

  await test.step('one in-flat picker for every furnishing, titled by what the owner is declaring', async () => {
    await expect(picker.getByText("What's already fitted?")).toBeVisible();
    await expect(picker.locator('.furn-tile', { hasText: 'Modular Kitchen' })).toBeVisible();

    await page.getByText('Furnishing Status').locator('..').getByText('Furnished', { exact: true }).click();
    await expect(picker.getByText("What's included?")).toBeVisible();
    await expect(picker.locator('.furn-tile', { hasText: 'Modular Kitchen' })).toBeVisible();
    await page.getByText('Furnishing Status').locator('..').getByText('Furnished', { exact: true }).click();
    await expect(picker.getByText("What's included?")).toBeVisible();
    await expect(picker.locator('.furn-tile', { hasText: 'Modular Kitchen' })).toBeVisible();
  });

  await test.step('a tile is a real control ? keyboard-operable and state-announced', async () => {
    const tile = page.locator('.furn-tile[aria-pressed]').first();
    await expect(tile).toHaveJSProperty('tagName', 'BUTTON');
    await expect(tile).toHaveAttribute('aria-pressed', 'false');
    // `html { scroll-behavior: smooth }` is on, so a scrolling focus() would still be animating
    // when the baseline is sampled and the assertion below would blame Space for the difference.
    await tile.evaluate((el) => el.focus({ preventScroll: true }));
    const restingY = await page.evaluate(() => window.scrollY);
    await page.keyboard.press(' ');
    await expect(tile).toHaveAttribute('aria-pressed', 'true');
    await expect(tile).toHaveClass(/checked/);
    // Space must not also page down, sliding the grid out from under the tile just chosen.
    expect(await page.evaluate(() => window.scrollY)).toBe(restingY);

    await page.keyboard.press('Enter');
    await expect(tile).toHaveAttribute('aria-pressed', 'false');
    // A custom tile is a remove button, so it is named for what activating it does rather than
    // carrying a pressed state that would read as "this amenity is off".
    const input = page.getByLabel('Add a custom furniture item');
    await input.fill('Study Table');
    await input.press('Enter');
    const custom = page.locator('.furn-tile[data-custom="true"]', { hasText: 'Study Table' });
    await expect(custom).toHaveAttribute('aria-label', 'Remove Study Table');
    await custom.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.furn-tile', { hasText: 'Study Table' })).toHaveCount(0);
  });

  await test.step('a user can add a custom item and remove it', async () => {
    const input = page.getByLabel('Add a custom furniture item');
    await input.fill('Study Table');
    await input.press('Enter');

    const custom = page.locator('.furn-tile[data-custom="true"]', { hasText: 'Study Table' });
    await expect(custom).toBeVisible();
    // Custom entries land already selected (checked) so they count toward the listing.
    await expect(custom).toHaveClass(/checked/);

    await input.fill('study table');
    await input.press('Enter');
    await expect(page.locator('.furn-tile', { hasText: 'Study Table' })).toHaveCount(1);

    await input.fill('AC');
    await input.press('Enter');
    await expect(page.locator('.furn-tile[data-custom="true"]')).toHaveCount(1);
    const acTile = page.locator('.furn-tile').filter({ has: page.getByText('AC', { exact: true }) });
    await expect(acTile).toHaveClass(/checked/);

    await custom.click();
    await expect(page.locator('.furn-tile', { hasText: 'Study Table' })).toHaveCount(0);
  });
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

  await input.fill('EV Charging');
  await page.getByRole('button', { name: /^Add$/ }).click();
  await expect(page.getByText('“EV Charging” is already in your list')).toBeVisible();
  await expect(page.locator('.furn-tile[data-custom="true"]', { hasText: 'EV Charging' })).toHaveCount(1);

  const box = await input.boundingBox();
  const form = await page.locator('.lp-step').first().boundingBox();
  expect(box.width).toBeLessThan(form.width * 0.7);

  await custom.click();
  await expect(page.locator('.furn-tile', { hasText: 'EV Charging' })).toHaveCount(0);
});
