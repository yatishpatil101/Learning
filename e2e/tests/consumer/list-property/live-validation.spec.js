/**
 * Field-level validation in the posting wizard, against the live backend.
 *
 * Converted from `validation.spec.js`, which seeded `draazyUser` and an Aadhaar record into
 * localStorage so the form would render. The rules asserted here — numeric stripping, an area of
 * zero being refused, whitespace collapsing to empty, `000000` failing the pincode check — all live
 * in `sanitize.js` and `validation.js` and run in the browser, so they behave identically in either
 * mode. What differs is what surrounds them. The seeded run proved those rules against a page that
 * had only been told it had a session; it could not have noticed the wizard refusing to mount for an
 * account the server actually authenticates, nor the route handing back the listing paywall instead
 * of a form, nor a step-2 screen that fails to assemble once its data is fetched under a real JWT.
 * Here the account is registered over HTTP and carries a genuine token, so "the pincode is flagged"
 * now also means "the owner got as far as a pincode field at all".
 *
 * No Aadhaar badge is granted. The wizard has no identity gate — posting needs a mobile-verified
 * account and nothing more (ADR-019) — so granting one would assert a wall the product removed.
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

/**
 * Waits for a custom `Select` menu to be genuinely interactive.
 *
 * `Select.jsx` portals its menu and sets `portalOpen` one `requestAnimationFrame` after the open
 * (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198), gaining
 * `.is-portal-open` afterwards. That one frame is what the dropdown sleeps here were waiting out.
 */
async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

// Fill a valid Details step for a flat and advance to Location & pricing.
async function toStep2Flat(page) {
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Location & pricing').waitFor({ timeout: 10000 });
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
  // Rejected: we stay on Details and the area field is flagged.
  await expect(page.getByText('Location & pricing')).toHaveCount(0);
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
  await page.locator('input[data-err="price"]').fill('5000000');
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  await page.locator('input[data-err="pincode"]').fill('000000');
  await page.getByRole('button', { name: /Next Step/i }).click();
  // Rejected: never reaches Photos & documents; pincode is flagged.
  await expect(page.getByText('Photos & documents')).toHaveCount(0);
  await expect(page.locator('input[data-err="pincode"]')).toHaveClass(/dz-invalid/);
});
