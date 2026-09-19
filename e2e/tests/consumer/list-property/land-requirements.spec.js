/* Land inherits residential defaults unless the form scopes them — a farm on sq.ft. with a floor of 100 rejects
 * an honest "0.5 acre". Driven through the wizard: the claim is composition, not storage.
 */
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

/* The unit and zone pickers carry no `data-err` — neither is ever scrolled to — so they are
   addressed through the label that names them rather than by position among the step's dropdowns. */
const labelled = (page, text) => page.locator(`xpath=//label[normalize-space()='${text}']/following-sibling::div[1]`);

/* The suffix beside the area box, which is the only place the chosen unit is spelled out — the
   picker itself shows the same label, so asserting on it would prove the picker agrees with itself. */
const unitSuffix = (page) => field(page, 'carpetArea').locator('xpath=following-sibling::div[1]');

for (const [type, unit] of [['Farm Land', 'Guntha'], ['Open Plot', 'sq.ft.']]) {
  /* A farm is transacted in guntha and acre and a plot in square feet; opening a farm on sq.ft.
     made the default itself the commonest wrong answer on the form. */
  test(`${type} opens on ${unit}`, async ({ page }) => {
    await gotoForm(page);
    await pickType(page, type);
    await expect(unitSuffix(page)).toHaveText(unit);
  });
}

/* Half an acre is a real Maharashtra parcel. The old range was the residential one — a floor of
   100 — so the form rejected it as a typo and the owner's only way past was to lie about the size. */
test('a half-acre farm passes the area check that a residential floor would have rejected', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Farm Land');
  await pick(page, labelled(page, 'Area Unit'), 'Acre');
  await field(page, 'carpetArea').fill('0.5');

  await next(page);
  await expect(field(page, 'carpetArea')).not.toHaveClass(/dz-invalid/);
});

test('the area error quotes the range in the unit the owner chose, not in square feet', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Farm Land');
  await pick(page, labelled(page, 'Area Unit'), 'Acre');
  await field(page, 'carpetArea').fill('900');

  await next(page);
  await expect(page.getByText('between 0.1 and 100 Acre')).toBeVisible();
});

test('a plot cannot advance without its NA status and its Other Rights entry', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Open Plot');
  await field(page, 'carpetArea').fill('2400');

  await next(page);
  await expect(invalid(page, 'naStatus')).toBeVisible();
  await expect(invalid(page, 'otherRights')).toBeVisible();

  await pick(page, field(page, 'naStatus'), 'NA order sanctioned');
  await pick(page, field(page, 'otherRights'), 'Clear — no entries');
  await next(page);
  await expect(invalid(page, 'naStatus')).toHaveCount(0);
});

/* Eligibility is a sale question: a tenant does not need to be an agriculturist to lease, so
   demanding it of a rental would be a rule the law does not carry. */
test('a farm for sale must say who can buy it, and a farm for rent is never asked', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Farm Land');
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

test('a farm carries the disclosure its deal calls for', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Farm Land');

  const restrictions = page.getByText('Not everyone can buy agricultural land', { exact: false });
  const tenancy = page.getByText('Letting farm land can create rights', { exact: false });

  await expect(restrictions).toBeVisible();
  await expect(tenancy).toHaveCount(0);

  await page.getByRole('button', { name: 'Rent' }).click();
  await expect(tenancy).toBeVisible();
  await expect(restrictions).toHaveCount(0);
});

/* A Zone Certificate says "Residential (R2)" or "Green Zone", and Green Zone is the one answer that tells a
   buyer they may build nothing at all — four bare words leave it unstatable. */
test('the Zone picker offers the vocabulary the Zone Certificate actually uses', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Open Plot');
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
});
