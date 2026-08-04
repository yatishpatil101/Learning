import { test, expect } from '@playwright/test';

/* PG / Hostel authoring details (owner "Post a property" flow), covering the
   step-1 changes made for the PG-sharing + floors + furnished enhancement:
   - the "Sharing Types" dropdown carries an owner-facing helper note
   - a PG carries a "No. of Floors" dropdown (building floor count), not a single
     Floor No. which is meaningless for a whole-building let
   - a furnished PG lists PG-specific inventory (e.g. Study Table), not a
     household Kitchen Trolley

   (2-/4-wheeler parking amenities are asserted on the commercial flow in
   list-property-types.spec.js, which shares the same amenity data model.) */

const BASE = 'http://localhost:5173';
const MOBILE = '9876543210';

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

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

test('PG rent flow: Sharing Types note, No. of Floors, and furnished PG items', async ({ page }) => {
  await gotoForm(page);
  await page.locator('.lp-step').getByText('Rent', { exact: true }).first().click();
  await pickType(page, 'PG / Hostel');

  // The Sharing Types options are now visible as a pill group (like Furnishing),
  // not hidden behind a dropdown, and the owner-facing helper note documents them.
  await expect(page.getByText(/Select every room-sharing option your PG offers/i)).toBeVisible();
  await expect(page.getByText('Single (No Sharing)', { exact: true })).toBeVisible();
  await expect(page.getByText('Double Sharing', { exact: true })).toBeVisible();
  await expect(page.getByText('Dormitory (6+)', { exact: true })).toBeVisible();

  // A PG carries a No. of Floors dropdown, not a single Floor No.
  await expect(page.getByText('No. of Floors', { exact: true })).toBeVisible();
  await expect(page.getByText('Floor No.', { exact: true })).toHaveCount(0);

  // A PG room has no built-up area — that field must not appear.
  await expect(page.getByText('Built-up Area', { exact: true })).toHaveCount(0);

  // Marking the PG furnished surfaces PG-specific inventory (Study Table), not a
  // household Kitchen Trolley.
  await page.getByText('Furnished', { exact: true }).click();
  await expect(page.getByText('Study Table', { exact: true })).toBeVisible();
  await expect(page.getByText('Kitchen Trolley', { exact: true })).toHaveCount(0);
});
