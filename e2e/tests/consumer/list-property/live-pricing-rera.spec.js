/**
 * Sale-side pricing affordances and the MahaRERA field, against the live backend.
 *
 * Converted from `pricing-rera.spec.js`. Both claims here are client-side derivations — the
 * ₹/sq.ft caption is price ÷ carpet area, and the RERA field's visibility is a branch on deal type
 * and property type — so the arithmetic is not what changes by running live. What changes is the
 * page the arithmetic runs on: the mock version computed it inside a wizard mounted for an account
 * that existed only in localStorage, and could not have noticed the caption going missing because
 * the step it lives on failed to render for a real session. The locality is picked by name rather
 * than by position, so this file does not depend on the order `GET /localities` returns.
 */
import { test, expect } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

/**
 * Waits for a custom `Select` menu to be genuinely interactive.
 *
 * `Select.jsx` portals its menu and sets `portalOpen` one `requestAnimationFrame` after the open
 * (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198) and it
 * gains `.is-portal-open` afterwards. That single frame is what the dropdown sleeps here were for.
 */
async function menuOpen(page) {
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await menuOpen(page);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

/* `.lp-steps` rather than the mock's `.lp-meter`: the meter renders on both the wizard and the
   listing-limit paywall, so it cannot tell them apart, and a paywalled account would have sailed
   past this wait and failed later on a missing field. The step rail exists only on the wizard. */
async function gotoForm(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

async function toStep2(page, type = 'Flat / Apartment') {
  await gotoForm(page);
  await page.locator('input[data-err="carpetArea"]').fill('1000');
  await pickType(page, type);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
}

async function toStep3(page, type = 'Flat / Apartment') {
  await toStep2(page, type);
  await pickOption(page, 'locality', 'Baner');
  const flat = page.locator('input[data-err="flatNumber"]');
  if (await flat.count()) await flat.fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="price"]').fill('12500000');
  const ownership = page.locator('[data-err="ownership"]');
  if (await ownership.count()) await pickOption(page, 'ownership', 'Freehold');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Property Documents & Verification/i', { timeout: 15000 });
}

test('P1: ₹/sq.ft caption appears under Expected Price for a sale once price + area are set', async ({ page }) => {
  await toStep2(page, 'Flat / Apartment');
  await page.locator('input[data-err="price"]').fill('12500000');
  // 1,25,00,000 / 1000 = 12,500 per sq.ft
  await expect(page.getByText(/₹\s*12,500\s*\/\s*sq\.ft/)).toBeVisible();
});

test('P2: MahaRERA field is shown for a flat sale and accepts an ID', async ({ page }) => {
  await toStep3(page, 'Flat / Apartment');
  const rera = page.getByPlaceholder('e.g. P52100012345');
  await expect(rera).toBeVisible();
  await rera.fill('p52100012345');
  // input sanitizes to uppercase alphanumerics
  await expect(rera).toHaveValue('P52100012345');
});

test('P2: MahaRERA field is hidden for Farm Land sale', async ({ page }) => {
  await toStep3(page, 'Farm Land');
  await expect(page.getByPlaceholder('e.g. P52100012345')).toHaveCount(0);
});

test('P2: MahaRERA field is hidden for a rent listing', async ({ page }) => {
  await gotoForm(page);
  // Switch deal to Rent before filling. The pill's own `selected` class (controls.jsx) is the
  // render signal the old "let the form settle" sleep was approximating.
  const rent = page.locator('.radio-pill', { hasText: 'Rent' }).first();
  await rent.click();
  await expect(rent).toHaveClass(/selected/);
  await page.locator('input[data-err="carpetArea"]').fill('1000');
  await pickType(page, 'Flat / Apartment');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="monthlyRent"]').fill('25000');
  await page.locator('input[data-err="deposit"]').fill('75000');
  await pickDate(page, '[data-err="availableFrom"]', '2026-08-01');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Property Documents & Verification/i', { timeout: 15000 });
  await expect(page.getByPlaceholder('e.g. P52100012345')).toHaveCount(0);
});
