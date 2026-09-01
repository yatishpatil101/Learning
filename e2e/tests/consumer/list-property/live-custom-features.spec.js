/**
 * Custom furniture and custom amenity entry in the posting wizard, against the live backend.
 *
 * Converted from `custom-features.spec.js`, which wrote `draazyUser` and an Aadhaar record
 * straight into localStorage so the whole-place flow would render into the form. The de-dupe rules
 * and the tile behaviour are client-side either way, so what the live version adds is everything
 * around them: the form now has to mount for an account the server issued a token for, and the
 * amenities test reaches step 3 by actually completing step 2 — choosing a locality from the list
 * the API serves, submitting the price and ownership, and getting the wizard to advance. The
 * seeded version could not fail on an empty locality list, a rejected step transition, or a
 * profile call that never returns, because none of those existed for it; it typed into a form the
 * browser had simply been told to show.
 *
 * No Aadhaar badge is granted. The wizard has no identity gate (D-no-gate), and granting one here
 * would quietly assert the opposite of what `live-no-gate` proves.
 */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

// Sign in as a real owner so the whole-place flow renders straight into the form.
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

async function toStep3Flat(page) {
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Location & pricing').waitFor({ timeout: 10000 });
  await page.locator('[data-err="locality"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Test Project');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="price"]').fill('5000000');
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
  await toStep3Flat(page);

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
