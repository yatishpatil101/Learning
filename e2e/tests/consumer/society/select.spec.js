import { test, expect } from '@playwright/test';

// Society "select or create" typeahead on the list-property Location step.
// Verifies a listing binds to a real society ENTITY (verified pick) and that an
// unknown name mints a community society + shows the pending-verification hint.

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543211';

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

async function toStep2Flat(page) {
  await gotoForm(page);
  await page.locator('[data-err="propertyType"]').click();
  /* `Select` portals its menu and only flips `portalOpen` one requestAnimationFrame after the open
     (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198). */
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Location & pricing').waitFor({ timeout: 10000 });
}

test('typing a known name lists the verified society and binds it on pick', async ({ page }) => {
  await toStep2Flat(page);
  const society = page.locator('input[data-err="society"]');
  await society.click();
  await society.fill('Skyline');
  const option = page.locator('.pn-dropdown__option', { hasText: 'Skyline Heights' }).first();
  await expect(option).toBeVisible();
  await expect(option.getByText('Verified')).toBeVisible();
  await option.click();
  await expect(society).toHaveValue('Skyline Heights');
  await expect(page.getByText(/Verified society/i)).toBeVisible();
});

test('an unknown name can be added inline and mints a community society', async ({ page }) => {
  await toStep2Flat(page);
  const society = page.locator('input[data-err="society"]');
  const NAME = 'Testville Residency 2026';
  await society.click();
  await society.fill(NAME);
  const addRow = page.locator('.pn-dropdown__option', { hasText: /^Add /i }).first();
  await expect(addRow).toBeVisible();
  await addRow.click();
  await expect(society).toHaveValue(NAME);
  await expect(page.getByText(/pending verification/i)).toBeVisible();

  // The society is persisted as a community-tier entity for ops to verify.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pnCommunitySocieties') || '[]'));
  expect(stored.some((s) => s.name === NAME && s.tier === 'community')).toBe(true);
});
