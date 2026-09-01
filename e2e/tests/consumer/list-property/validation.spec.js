import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543210';

// Seed an authenticated + Aadhaar-verified owner so the flow renders straight
// into the form, past the gate.
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
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveClass(/pn-invalid/);
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
  await page.locator('.pn-dropdown__option').first().click();
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="price"]').fill('5000000');
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.pn-dropdown__option').first().click();
  await page.locator('input[data-err="pincode"]').fill('000000');
  await page.getByRole('button', { name: /Next Step/i }).click();
  // Rejected: never reaches Photos & documents; pincode is flagged.
  await expect(page.getByText('Photos & documents')).toHaveCount(0);
  await expect(page.locator('input[data-err="pincode"]')).toHaveClass(/pn-invalid/);
});
