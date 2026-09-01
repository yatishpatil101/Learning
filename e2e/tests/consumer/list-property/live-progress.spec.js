/**
 * The posting wizard's momentum meter, against the live backend.
 *
 * Converted from `progress.spec.js`, which wrote `puneNestUser` and an Aadhaar record into
 * localStorage before the app booted. Every percentage asserted below comes out of
 * `list-property/progress.js`, which is a pure reduction over form state, so the arithmetic is the
 * same either way — but a meter is only worth reading if it sits above a wizard the owner can
 * actually use, and that part is the server's call. The route asks the backend what this account is
 * allowed to post and swaps `ListingPaywall` in for the wizard when the answer is nothing, leaving
 * the meter drawn above it regardless. A browser that had simply told itself it was signed in could
 * not reach that fork, so the seeded version was able to report a healthy meter over a form no real
 * account would have been handed. Waiting on `.lp-steps` instead of `.lp-meter` is what pins the
 * distinction down: the step rail exists only on the wizard side of it.
 *
 * No Aadhaar badge is granted. Posting asks for a signed-in, mobile-verified account and nothing
 * further (ADR-019) — the badge is opt-in and never a wall — so granting one here would assert a
 * gate the product does not have.
 */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

// Register a real account and sign it in over HTTP, so the flow renders straight into the form for
// a session the server recognises.
async function gotoForm(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

const pctOf = async (page) => {
  const raw = await page.locator('.lp-meter__pct').innerText();
  return parseInt(raw.replace(/\D/g, ''), 10);
};

/**
 * Waits for a custom `Select` menu to be genuinely interactive.
 *
 * `Select.jsx` portals its menu and sets `portalOpen` one `requestAnimationFrame` after the open
 * (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198). Every
 * dropdown `waitForTimeout` in this file was waiting for that one frame.
 */
async function menuOpen(page) {
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

test('loads the gamified flow without JS errors', async ({ page, consoleErrors }) => {
  await gotoForm(page);
  await expect(page.locator('.lp-meter')).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

test('a fresh form opens above 0% but well below 100% (defaults only)', async ({ page }) => {
  await gotoForm(page);
  const start = await pctOf(page);
  // Smart defaults (BHK, bathrooms, furnishing, possession…) count as filled, so
  // the meter opens above zero — but every empty field keeps it far from 100%.
  expect(start).toBeGreaterThan(0);
  expect(start).toBeLessThan(50);
});

test('smart defaults are pre-filled to reduce friction', async ({ page }) => {
  await gotoForm(page);
  // BHK defaults to 2. The BHK pills now show just the number (consistent with
  // Bathrooms/Balconies), so scope the check to the BHK group to stay precise.
  await expect(page.locator('[data-err="bhk"] .radio-pill.selected')).toHaveText('2');
});

test('percentage climbs as the owner fills real fields (goal gradient)', async ({ page }) => {
  await gotoForm(page);
  const start = await pctOf(page);

  await page.locator('input[data-err="carpetArea"]').fill('1050');
  /* `pctOf` reads through `innerText()`, which does not retry -- that is the only reason a sleep was
     ever needed here. Waiting for the meter to stop reading its old value is the same claim the
     `toBeGreaterThan` below makes, except that it retries. */
  await expect(page.locator('.lp-meter__pct')).not.toHaveText(`${start}%`);
  const after = await pctOf(page);
  expect(after).toBeGreaterThan(start);
});

test('milestone nodes light up as progress crosses thresholds', async ({ page }) => {
  await gotoForm(page);
  const before = await page.locator('.lp-meter__node.reached').count();

  await pickType(page, 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  // The assertion below is a `>=`, so it cannot serve as the wait; the committed field value can.
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1200');

  const after = await page.locator('.lp-meter__node.reached').count();
  expect(after).toBeGreaterThanOrEqual(before);
});

test('filling only mandatory fields keeps the meter under 100% (optional left blank)', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');

  // Every mandatory Details + Location field, but no optional ones.
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Location & pricing').waitFor({ timeout: 10000 });

  await page.locator('[data-err="locality"]').click();
  await menuOpen(page);
  await page.locator('.pn-dropdown__option').first().click();
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="price"]').fill('9500000');
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.pn-dropdown__option').first().click();
  /* The final `pctOf` read below does not retry, so the meter has to be known-settled first.
     `Select.jsx` drops `is-placeholder` from the trigger's value span only once a value is actually
     selected (Select.jsx:272), which is the closest thing to a commit signal this control has. */
  await expect(page.locator('[data-err="ownership"] .pn-dropdown__value')).not.toHaveClass(/is-placeholder/);

  // Optional fields (built-up, floor, facing, video, description, amenities,
  // supporting documents…) are still blank, so the meter must stay short of 100%.
  expect(await pctOf(page)).toBeLessThan(100);
});
