import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors } from '../../../helpers/listingForm.helper.js';
import { fillSociety } from '../../../helpers/places.js';
import { pickLocality } from '../../../helpers/locality.js';

async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

async function gotoForm(page, deal = 'buy') {
  await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await page.locator('.radio-pill', { hasText: deal === 'rent' ? 'Rent' : 'Sale' }).first().click();
}

async function gotoPricing(page, deal = 'buy') {
  await gotoForm(page, deal);
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickLocality(page, 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await fillSociety(page, 'Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
}

test('residential area fields: typing is sanitised, carpet area is bounded 100-20,000 sq.ft, and built-up cannot shrink below the prior area', async ({ page }) => {
  test.slow();
  await gotoForm(page);
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  const carpetArea = page.locator('input[data-err="carpetArea"]');

  await test.step('numeric fields strip letters, signs and extra dots as you type', async () => {
    await carpetArea.fill('-1a2.3.4');
    await expect(carpetArea).toHaveValue('12.34');
  });

  await test.step('residential carpet area is bounded between 100 and 20,000 sq.ft', async () => {
    await carpetArea.fill('99');
    await page.getByRole('button', { name: /Next Step/i }).click();
    await expect(carpetArea).toHaveClass(/dz-invalid/);
    await expect(page.locator('.gm-style')).toHaveCount(0);

    await carpetArea.fill('20001');
    await page.getByRole('button', { name: /Next Step/i }).click();
    await expect(carpetArea).toHaveClass(/dz-invalid/);
    await expect(page.locator('.gm-style')).toHaveCount(0);
  });

  await test.step('residential built-up and super built-up areas cannot shrink below the prior area', async () => {
    await carpetArea.fill('1200');
    await page.locator('input[data-err="builtUp"]').fill('1199');
    await page.locator('input[data-err="superBuiltUp"]').fill('1100');
    await page.getByRole('button', { name: /Next Step/i }).click();

    await expect(page.locator('input[data-err="builtUp"]')).toHaveClass(/dz-invalid/);
    await expect(page.locator('input[data-err="superBuiltUp"]')).toHaveClass(/dz-invalid/);
    await expect(page.locator('.gm-style')).toHaveCount(0);
  });
});

test('sale price must be at least one lakh', async ({ page }) => {
  await gotoPricing(page);
  await page.locator('input[data-err="price"]').fill('85000');
  await page.getByRole('button', { name: /Next Step/i }).click();

  await expect(page.locator('input[data-err="price"]')).toHaveClass(/dz-invalid/);
  await expect(page.getByRole('heading', { name: /Photos & description/i })).toHaveCount(0);
});

test('rent must be at least one thousand and deposit is capped at two years', async ({ page }) => {
  await gotoPricing(page, 'rent');
  await page.locator('input[data-err="monthlyRent"]').fill('900');
  await page.locator('input[data-err="deposit"]').fill('25000');
  await page.getByRole('button', { name: /Next Step/i }).click();

  await expect(page.locator('input[data-err="monthlyRent"]')).toHaveClass(/dz-invalid/);
  await expect(page.locator('input[data-err="deposit"]')).toHaveClass(/dz-invalid/);
  await expect(page.getByRole('heading', { name: /Photos & description/i })).toHaveCount(0);
});
