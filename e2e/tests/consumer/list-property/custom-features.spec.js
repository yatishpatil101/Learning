import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543210';

// Seed an authenticated + Aadhaar-verified owner so the whole-place flow renders
// straight into the form, past the gate.
async function gotoForm(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now(),
    }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({
      verified: true, aadhaarMobile: mobile, at: Date.now(),
    }));
  }, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
}

/**
 * Waits for a custom `Select` menu to be genuinely interactive.
 *
 * `Select.jsx` portals its menu and sets `portalOpen` one `requestAnimationFrame` after the open
 * (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198), gaining
 * `.is-portal-open` afterwards. That one frame is what the dropdown sleeps here were waiting out.
 */
async function menuOpen(page) {
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

async function toStep3Flat(page) {
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Location & pricing').waitFor({ timeout: 10000 });
  await page.locator('[data-err="locality"]').click();
  await menuOpen(page);
  await page.locator('.pn-dropdown__option').first().click();
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Test Project');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="price"]').fill('5000000');
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.pn-dropdown__option').first().click();
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
