import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543210';

function seed(page) {
  return page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
}

async function gotoStep2(page) {
  await seed(page);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(250);
  const opt = page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' });
  if (await opt.count()) await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

async function gotoStep3Buy(page) {
  await gotoStep2(page);
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="price"]').fill('12500000');
  await pickOption(page, 'ownership', 'Freehold');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Property Documents & Verification/i', { timeout: 10000 });
}

test('locality search moves the pin (offline gazetteer)', async ({ page }) => {
  await gotoStep2(page);
  // The pin is not treated as "set" until the owner acts, so no confirmation shows yet.
  await expect(page.locator('text=/Location set:/')).toHaveCount(0);
  await page.getByPlaceholder(/Search a locality/i).fill('Kharadi');
  await page.getByRole('button', { name: 'Search location' }).click();
  await page.waitForTimeout(500);
  const readout = page.locator('text=/Location set:/');
  await expect(readout).toBeVisible();
  // Kharadi ≈ 18.5510, 73.9410
  await expect(readout).toContainText('73.94');
});

test('SALE flow: Price Negotiable sits beside Expected Price; Sale Type & Possession are tiles', async ({ page }) => {
  await gotoStep2(page);
  // Expected Price and Price Negotiable share one grid row.
  const priceRow = page.locator('div.grid', { has: page.locator('input[data-err="price"]') }).first();
  await expect(priceRow.locator('.toggle-track')).toHaveCount(1);
  await expect(priceRow.locator('p.text-white', { hasText: 'Price Negotiable' })).toBeVisible();
  // The old descriptive subtitle was removed for a tighter tile.
  await expect(page.getByText('Allow buyers to negotiate the price')).toHaveCount(0);
  // Sale Type and Possession Status rendered as side-by-side tiles.
  await expect(page.getByText('Sale Type', { exact: true })).toBeVisible();
  await expect(page.getByText('Possession Status *')).toBeVisible();
  // Monthly Maintenance present in the pricing cluster.
  await expect(page.getByText(/Monthly Maintenance/i)).toBeVisible();
});

test('Sale Type and Possession options are equal side-by-side pills (2-col grid)', async ({ page }) => {
  await gotoStep2(page);
  const possession = page.locator('[data-err="possession"]');
  // Options laid out in a two-column grid inside the tile.
  await expect(possession.locator('.grid.grid-cols-2')).toHaveCount(1);
  // Selecting "Available From" reveals the calendar BELOW the pills (full width).
  await possession.getByText('Available From', { exact: true }).click();
  await expect(possession.locator('[data-err="availableFrom"]')).toBeVisible();
});

test('ownership proof is optional to post — it earns a badge rather than gating', async ({ page }) => {
  /* This used to assert the opposite: submitting without Index II raised a `[data-err="documents"]`
     tile with a red upload control and "Upload Index II (ownership proof)".
   *
   * That gate was removed on purpose (see constants.js, `ownership documents`): every document is
   * now optional and the ownership proof is flagged `verifies` rather than `required`, because it
   * is what earns the Verified Owner badge, not a condition of publishing — "a genuine owner who
   * can't find their Index II today isn't blocked from listing". So the old assertion was testing
   * a rule the product deliberately dropped.
   *
   * What is worth holding onto is the deal it replaced the gate with: the document is offered, it
   * is marked optional, its badge payoff is stated, and submitting without it is not blocked. */
  await gotoStep3Buy(page);

  const indexII = page.locator('label', { hasText: 'Index II — Property Ownership Proof' }).first();
  await expect(indexII).toBeVisible();
  await expect(indexII).toContainText(/\(optional\)/i);
  // The payoff is named, so an owner can weigh uploading against skipping.
  await expect(page.getByText(/Earns your Verified Owner badge/i).first()).toBeVisible();

  // Submitting with no document raises no document error — photos are the only hard requirement.
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-err="documents"]')).toHaveCount(0);
});

test('documents section explains why documents are collected (trust copy)', async ({ page }) => {
  await gotoStep3Buy(page);
  await expect(page.getByText('Why we ask for documents')).toBeVisible();
  await expect(page.getByText(/never shown to buyers/i)).toBeVisible();
});

test('photo upload is compulsory: submitting with no photo flags the upload zone', async ({ page }) => {
  await gotoStep3Buy(page);
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await page.waitForTimeout(300);
  const zone = page.locator('[data-err="photos"]');
  await expect(zone).toHaveCount(1);
  await expect(zone.locator('label.upload-zone')).toHaveClass(/pn-invalid/);
  await expect(zone.locator('p.pn-field-error')).toBeVisible();
  // Required marker present on the label.
  await expect(zone.getByText('Property Photos *')).toBeVisible();
});

test('uploading a photo clears the compulsory-photo error', async ({ page }) => {
  await gotoStep3Buy(page);
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await page.waitForTimeout(300);
  const zone = page.locator('[data-err="photos"]');
  await expect(zone.locator('label.upload-zone')).toHaveClass(/pn-invalid/);
  /* Scoped to the drop zone's own input. The uploader now offers a second file input beside it —
     a mobile-only "Take photo" control carrying `capture="environment"`, which asks the OS for the
     camera rather than the gallery — so an unscoped `input[type="file"]` matches two elements.
     Targeting the drop zone is also the right choice on merit: this test is about the desktop
     gallery path, and the camera input is `sm:hidden`. */
  await zone.locator('label.upload-zone input[type="file"]').setInputFiles({
    name: 'living-room.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.waitForTimeout(300);
  await expect(zone.locator('label.upload-zone')).not.toHaveClass(/pn-invalid/);
});
