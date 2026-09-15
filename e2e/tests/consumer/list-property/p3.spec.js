// Real sessions and entitlements ensure validation assertions run on a usable wizard, not a paywall.
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

// Portal mounting precedes interactivity by one animation frame.
async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function gotoStep2(page) {
  await signedInAsNew(page);
  await page.goto('/list-property');
  // The step rail distinguishes the wizard from the paywall, which also renders the meter.
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  const opt = page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' });
  await expect(opt).toHaveCount(1);
  await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
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
  await page.waitForSelector('text=/Property Documents & Verification/i', { timeout: 15000 });
}

test('locality search moves the pin (offline gazetteer)', async ({ page }) => {
  await gotoStep2(page);
  // The pin is not treated as "set" until the owner acts, so no confirmation shows yet.
  await expect(page.locator('text=/Location set:/')).toHaveCount(0);
  await page.getByPlaceholder(/Search a locality/i).fill('Kharadi');
  await page.getByRole('button', { name: 'Search location' }).click();
  const readout = page.locator('text=/Location set:/');
  await expect(readout).toBeVisible();
  await expect(readout).toContainText('73.94');
});

test('SALE flow: Negotiable sits beside Expected Price and possession remains available', async ({ page }) => {
  await gotoStep2(page);
  const priceRow = page.locator('div.grid', { has: page.locator('input[data-err="price"]') }).first();
  await expect(priceRow.locator('.toggle-track')).toHaveCount(1);
  await expect(priceRow.getByText('Negotiable')).toBeVisible();
  // Geometry distinguishes a subordinate switch from an equally wide pricing column.
  const split = await page.evaluate(() => {
    const price = document.querySelector('input[data-err="price"]');
    const row = price.closest('.grid');
    const toggle = row.querySelector('.toggle-track').closest('.min-w-0');
    return toggle.getBoundingClientRect().width / row.getBoundingClientRect().width;
  });
  expect(split).toBeGreaterThan(0.2);
  expect(split).toBeLessThan(0.4);
  // The amount is echoed in words under the input, so a stray zero is visible before Next.
  await page.locator('input[data-err="price"]').fill('12500000');
  await expect(priceRow.getByText('≈ ₹ 1.25 Crore')).toBeVisible();
  // Geometry distinguishes a shared line from two individually visible stacked readouts.
  const words = priceRow.getByText('≈ ₹ 1.25 Crore');
  const rate = priceRow.getByText(/\/\s*sq\.ft/);
  const [wordsBox, rateBox] = [await words.boundingBox(), await rate.boundingBox()];
  expect(Math.abs(wordsBox.y - rateBox.y)).toBeLessThan(2);
  expect(wordsBox.x + wordsBox.width).toBeLessThanOrEqual(rateBox.x);
  await expect(page.getByText('Allow buyers to negotiate the price')).toHaveCount(0);
  await expect(page.getByText('Sale Type', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Possession Status *')).toBeVisible();
  await expect(page.getByText(/Monthly Maintenance/i)).toBeVisible();
});

test('Possession options are equal side-by-side pills (2-col grid)', async ({ page }) => {
  await gotoStep2(page);
  const possession = page.locator('[data-err="possession"]');
  await expect(possession.locator('.grid.grid-cols-2')).toHaveCount(1);
  await possession.getByText('Available From', { exact: true }).click();
  await expect(possession.locator('[data-err="availableFrom"]')).toBeVisible();
});

test('ownership proof is optional to post — it earns a badge rather than gating', async ({ page }) => {
  // Ownership proof earns a badge; missing paperwork must not prevent an otherwise valid post.
  await gotoStep3Buy(page);

  const indexII = page.locator('label', { hasText: 'Index II — Property Ownership Proof' }).first();
  await expect(indexII).toBeVisible();
  await expect(indexII).toContainText(/\(optional\)/i);
  // The payoff is named, so an owner can weigh uploading against skipping.
  await expect(page.getByText(/Earns your Verified Owner badge/i).first()).toBeVisible();

  // Submitting with no document raises no document error — photos are the only hard requirement.
  await page.getByRole('button', { name: /Submit Property/i }).click();
  // The photo error proves validation ran before checking the absence of a document error.
  await expect(page.locator('[data-err="photos"] label.upload-zone')).toHaveClass(/dz-invalid/);
  await expect(page.locator('[data-err="documents"]')).toHaveCount(0);
});

test('documents section explains why documents are collected (trust copy)', async ({ page }) => {
  await gotoStep3Buy(page);
  await expect(page.getByText('Why we ask for documents')).toBeVisible();
  await expect(page.getByText('never shown to buyers', { exact: true })).toBeVisible();
});

test('photo upload is compulsory: submitting with no photo flags the upload zone', async ({ page }) => {
  await gotoStep3Buy(page);
  await page.getByRole('button', { name: /Submit Property/i }).click();
  const zone = page.locator('[data-err="photos"]');
  await expect(zone).toHaveCount(1);
  await expect(zone.locator('label.upload-zone')).toHaveClass(/dz-invalid/);
  await expect(zone.locator('p.dz-field-error')).toBeVisible();
  await expect(zone.getByText('Property Photos *')).toBeVisible();
});

test('uploading a photo clears the compulsory-photo error', async ({ page }) => {
  await gotoStep3Buy(page);
  await page.getByRole('button', { name: /Submit Property/i }).click();
  const zone = page.locator('[data-err="photos"]');
  await expect(zone.locator('label.upload-zone')).toHaveClass(/dz-invalid/);
  // Isolate the gallery picker from the camera input; canvas-generated bytes exercise real decoding.
  await zone.locator('label.upload-zone input[type="file"]').setInputFiles({
    name: 'living-room.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=', 'base64'),
  });
  // A thumbnail proves the file reached state; absence of an error alone would pass without an upload.
  await expect(zone.locator('.grid img')).toHaveCount(1);
  await expect(zone.locator('label.upload-zone')).not.toHaveClass(/dz-invalid/);
});
