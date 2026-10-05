// Driven through the wizard: the claim is composition, not storage.
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

async function gotoForm(page) {
  await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
}
/* `Select.jsx` portals its menu and flips `portalOpen` a frame late, so until `.is-portal-open`
   lands the menu is `pointer-events: none` — waiting on the class fails loudly, a sleep does not. */

async function pick(page, trigger, option) {
  await trigger.click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: option }).first().click();
}

const pickType = (page, label) => pick(page, page.locator('[data-err="propertyType"]'), label);
const field = (page, key) => page.locator(`[data-err="${key}"]`);
const invalid = (page, key) => page.locator(`[data-err="${key}"] .dz-dropdown__trigger.dz-invalid`);
const next = (page) => page.getByRole('button', { name: /Next Step/i }).click();
const pickSale = (page) => page.locator('[data-err="deal"]').getByRole('button', { name: 'Sale', exact: true }).click();
/* The unit and zone pickers carry no `data-err` — neither is ever scrolled to — so they are
   addressed through the label that names them rather than by position among the step's dropdowns. */

const labelled = (page, text) => page.locator(`xpath=//label[normalize-space()='${text}']/following-sibling::div[1]`);
/* The suffix beside the area box, which is the only place the chosen unit is spelled out — the
   picker itself shows the same label, so asserting on it would prove the picker agrees with itself. */

const unitSuffix = (page) => field(page, 'carpetArea').locator('xpath=following-sibling::div[1]');

test('a farm: opens on Guntha, accepts half an acre, quotes its range in the chosen unit, and carries the disclosure and buyer eligibility its deal calls for', async ({ page }) => {
  test.slow();
  await gotoForm(page);
  await pickType(page, 'Farm Land');

  await test.step('Farm Land opens on Guntha', async () => {
    await expect(unitSuffix(page)).toHaveText('Guntha');
  });

  await test.step('a half-acre farm passes the area check that a residential floor would have rejected', async () => {
    await pick(page, labelled(page, 'Area Unit'), 'Acre');
    await field(page, 'carpetArea').fill('0.5');

    await next(page);
    await expect(field(page, 'carpetArea')).not.toHaveClass(/dz-invalid/);
  });

  await test.step('the area error quotes the range in the unit the owner chose, not in square feet', async () => {
    await field(page, 'carpetArea').fill('900');

    await next(page);
    await expect(page.getByText('between 0.1 and 100 Acre')).toBeVisible();
  });

  await test.step('a farm carries the disclosure its deal calls for', async () => {
    await pickSale(page);
    const restrictions = page.getByText('Not everyone can buy agricultural land', { exact: false });
    const tenancy = page.getByText('Letting farm land can create rights', { exact: false });

    await expect(restrictions).toBeVisible();
    await expect(tenancy).toHaveCount(0);

    await page.getByRole('button', { name: 'Rent' }).click();
    await expect(tenancy).toBeVisible();
    await expect(restrictions).toHaveCount(0);
  });

  await test.step('a farm for sale must say who can buy it, and a farm for rent is never asked', async () => {
    await pickSale(page);
    await field(page, 'carpetArea').fill('12');
    await pick(page, field(page, 'naStatus'), 'Still agricultural');
    await pick(page, field(page, 'otherRights'), 'Not checked yet');

    await next(page);
    await expect(invalid(page, 'buyerEligibility')).toBeVisible();

    await page.getByRole('button', { name: 'Rent' }).click();
    await expect(field(page, 'buyerEligibility')).toHaveCount(0);
    await next(page);
    await expect(page.getByRole('heading', { name: 'Location' })).toBeVisible();
  });
});

test('a plot: opens on sq.ft., offers the Zone Certificate vocabulary, and cannot advance without its NA status and Other Rights', async ({ page }) => {
  test.slow();
  await gotoForm(page);
  await pickType(page, 'Open Plot');

  await test.step('Open Plot opens on sq.ft.', async () => {
    await expect(unitSuffix(page)).toHaveText('sq.ft.');
  });

  await test.step('the Zone picker offers the vocabulary the Zone Certificate actually uses', async () => {
    await labelled(page, 'Zoning').click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();

    const zones = (await page.locator('.dz-dropdown__option').allInnerTexts()).map((z) => z.trim());
    expect(zones).toEqual([
      'Residential (R1)',
      'Residential (R2)',
      'Commercial (C-1)',
      'Industrial (I-1)',
      'Public / Semi-public',
      'Mixed-Use',
      'Agriculture Zone',
      'Green Zone / No-Development Zone',
    ]);
    await page.keyboard.press('Escape');
  });

  await test.step('a plot cannot advance without its NA status and its Other Rights entry', async () => {
    await field(page, 'carpetArea').fill('2400');

    await next(page);
    await expect(invalid(page, 'naStatus')).toBeVisible();
    await expect(invalid(page, 'otherRights')).toBeVisible();

    await pick(page, field(page, 'naStatus'), 'NA order sanctioned');
    await pick(page, field(page, 'otherRights'), 'Clear — no entries');
    await next(page);
    await expect(invalid(page, 'naStatus')).toHaveCount(0);
  });
});
