import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

async function gotoForm(page) {
  await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
}

async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

async function pickByLabel(page, label, option) {
  await page.locator(`xpath=//label[normalize-space()='${label}']/following-sibling::div[1]`).click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: option }).first().click();
}

async function openByLabel(page, label) {
  await page.locator(`xpath=//label[normalize-space()='${label}']/following-sibling::div[1]`).click();
  await menuOpen(page);
}

const inputByLabel = (page, label) =>
  page.locator(`xpath=//label[normalize-space()='${label}']/following-sibling::div[1]//input`);

async function fillFlatDetails(page, { deal = 'buy' } = {}) {
  await gotoForm(page);
  await page.locator('.lp-step').getByText(deal === 'rent' ? 'Rent' : 'Sale', { exact: true }).first().click();
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();
  await page.locator('input[data-err="carpetArea"]').fill('1000');
  await pickOption(page, 'floor', '9');
  await pickOption(page, 'totalFloors', '14');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('B3 Homes');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
}

test('details and sale pricing expose B3 owner choices', async ({ page }) => {
  await gotoForm(page);
  await page.locator('.radio-pill', { hasText: 'Sale' }).first().click();
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();

  await openByLabel(page, 'Facing');
  await expect(page.locator('.dz-dropdown__option')).toHaveText(['East', 'West', 'North', 'South']);
  await page.keyboard.press('Escape');

  await expect(page.locator('[data-err="bhk"] .radio-pill', { hasText: '5+' })).toBeVisible();

  await page.locator('input[data-err="carpetArea"]').fill('1000');
  await pickOption(page, 'floor', '9');
  await pickOption(page, 'totalFloors', '14');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('B3 Homes');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });

  const loan = page.locator('[data-err="loanAvailable"]');
  await expect(loan).toBeVisible();
  await expect(loan.locator('.radio-pill.selected')).toHaveCount(0);

  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await expect(page.locator('.dz-dropdown__option', { hasText: 'Freehold' })).toBeVisible();
  await expect(page.locator('.dz-dropdown__option', { hasText: 'Power of Attorney' })).toBeVisible();
});

test('preferred tenant bachelor buckets are mutually exclusive', async ({ page }) => {
  await fillFlatDetails(page, { deal: 'rent' });

  const bachelors = page.getByRole('button', { name: 'Bachelors', exact: true });
  const male = page.getByRole('button', { name: 'Bachelor (Male)', exact: true });
  const female = page.getByRole('button', { name: 'Bachelor (Female)', exact: true });

  await male.click();
  await expect(male).toHaveClass(/selected/);
  await bachelors.click();
  await expect(bachelors).toHaveClass(/selected/);
  await expect(male).not.toHaveClass(/selected/);
  await female.click();
  await expect(female).toHaveClass(/selected/);
  await expect(bachelors).not.toHaveClass(/selected/);
});

test('land dimensions fill square-foot area and guntha pricing captions use the chosen unit', async ({ page }) => {
  await gotoForm(page);
  await page.locator('.radio-pill', { hasText: 'Sale' }).first().click();
  await pickOption(page, 'propertyType', 'Open Plot');

  await inputByLabel(page, 'Plot Length').fill('60');
  await inputByLabel(page, 'Plot Width').fill('40');
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('2400');

  await pickByLabel(page, 'Area Unit', 'Guntha');
  await page.locator('input[data-err="carpetArea"]').fill('2');
  await pickOption(page, 'naStatus', 'Deemed NA');
  await pickOption(page, 'otherRights', 'Clear');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });

  await page.locator('input[data-err="price"]').fill('10000000');
  await expect(page.getByText(/₹\s*50,00,000\s*\/\s*guntha/i)).toBeVisible();
});
