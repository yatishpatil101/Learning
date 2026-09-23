/**
 * Sale-side pricing affordances and the MahaRERA field, against the live backend.
 *
 * Both claims here are client-side derivations — the ₹/sq.ft caption is price ÷ carpet area, and
 * the RERA field's visibility is a branch on deal type and property type — so the arithmetic is not
 * what running live buys. What it buys is the page the arithmetic runs on: the wizard mounted for
 * an account the server registered, so a caption going missing because its step failed to render
 * for a real session is visible here. The locality is picked by name rather than by position, so
 * this file does not depend on the order `GET /localities` returns.
 */
import { test, expect } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

/**
 * Waits for a custom `Select` menu to be genuinely interactive.
 *
 * `Select.jsx` portals its menu and sets `portalOpen` one `requestAnimationFrame` after the open
 * (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198) and it
 * gains `.is-portal-open` afterwards. Waiting on that class is what makes the frame observable.
 */
async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

/* `.lp-steps` rather than `.lp-meter`: the meter renders on both the wizard and the listing-limit
   paywall, so it cannot tell them apart, and a paywalled account would sail past this wait and
   fail later on a missing field. The step rail exists only on the wizard. */
async function gotoForm(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

async function toPricing(page, type = 'Flat / Apartment') {
  await gotoForm(page);
  await page.locator('input[data-err="carpetArea"]').fill('1000');
  await pickType(page, type);
  // Towered types owe a floor before the step will advance; land and houses are never asked.
  for (const dataErr of ['floor', 'totalFloors']) {
    const select = page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`);
    if (!await select.count()) continue;
    await select.click();
    await menuOpen(page);
    await page.getByRole('option', { name: dataErr === 'floor' ? '9' : '14', exact: true }).click();
  }
  /* Land owes its own three answers, and step 1 will not advance without them — which is why this
     is presence-guarded like the floors above rather than branched on the type: the helper is
     asked for a type, not told what shape it is. Missing them is not a visible error here, it is a
     "Next Step" that silently does nothing, so the failure surfaces one wait later as a map that
     never renders. `Deemed NA` is deliberate (the sanctioned order is the one land answer that
     demands a document, and this file is not about the upload gate); `buyerEligibility` is asked
     of a farm-land *sale* only. Kept in step with `land-minimum.spec.js`, which walks the same
     minimum and is the reason we know the type itself publishes. */
  for (const [dataErr, label] of [['naStatus', 'Deemed NA'], ['otherRights', 'Clear'],
    ['buyerEligibility', 'Agriculturist buyer only']]) {
    if (await page.locator(`[data-err="${dataErr}"]`).count()) await pickOption(page, dataErr, label);
  }
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });

  // The address step stands between the details and the money. Land is never asked for a unit.
  await pickOption(page, 'locality', 'Baner');
  for (const [dataErr, value] of [['flatNumber', 'B-1204'], ['society', 'Skyline Heights']]) {
    const box = page.locator(`input[data-err="${dataErr}"]`);
    if (await box.count()) await box.fill(value);
  }
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
}

test('P1: ₹/sq.ft caption appears under Expected Price for a sale once price + area are set', async ({ page }) => {
  await toPricing(page, 'Flat / Apartment');
  await page.locator('input[data-err="price"]').fill('12500000');
  // 1,25,00,000 / 1000 = 12,500 per sq.ft
  await expect(page.getByText(/₹\s*12,500\s*\/\s*sq\.ft/)).toBeVisible();
});

test('P2: MahaRERA field is shown for a flat sale and accepts an ID', async ({ page }) => {
  // On the pricing step, beside the possession answer that decides whether the number is owed.
  await toPricing(page, 'Flat / Apartment');
  const rera = page.getByPlaceholder('e.g. P52100012345');
  await expect(rera).toBeVisible();
  await rera.fill('p52100012345');
  // input sanitizes to uppercase alphanumerics
  await expect(rera).toHaveValue('P52100012345');
});

test('P2: MahaRERA field is hidden for Farm Land sale', async ({ page }) => {
  await toPricing(page, 'Farm Land');
  await expect(page.getByPlaceholder('e.g. P52100012345')).toHaveCount(0);
});

test('P2: MahaRERA field is hidden for a rent listing', async ({ page }) => {
  await gotoForm(page);
  // Switch deal to Rent before filling. The pill's own `selected` class (controls.jsx) is the
  // render signal, so the re-render is waited on rather than slept through.
  const rent = page.locator('.radio-pill', { hasText: 'Rent' }).first();
  await rent.click();
  await expect(rent).toHaveClass(/selected/);
  await page.locator('input[data-err="carpetArea"]').fill('1000');
  await pickType(page, 'Flat / Apartment');
  for (const [dataErr, value] of [['floor', '9'], ['totalFloors', '14']]) {
    await page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`).click();
    await menuOpen(page);
    await page.getByRole('option', { name: value, exact: true }).click();
  }
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  await page.locator('input[data-err="monthlyRent"]').fill('25000');
  await page.locator('input[data-err="deposit"]').fill('75000');
  await pickDate(page, '[data-err="availableFrom"]', '2027-08-01');
  await expect(page.getByPlaceholder('e.g. P52100012345')).toHaveCount(0);
});
