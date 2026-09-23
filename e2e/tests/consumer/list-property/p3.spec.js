// Real sessions and entitlements ensure validation assertions run on a usable wizard, not a paywall.
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';
import { pickFloors } from '../../../helpers/listingForm.helper.js';

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
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

async function gotoPricing(page) {
  await gotoStep2(page);
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
}

async function gotoUploadsBuy(page) {
  await gotoPricing(page);
  await page.locator('input[data-err="price"]').fill('12500000');
  await pickOption(page, 'ownership', 'Freehold');
  await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
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
  await gotoPricing(page);
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
  await expect(priceRow.getByText(/\/\s*sq\.ft/)).toBeVisible();
  /* Both boxes come from one layout read: two sequential boundingBox() calls are two measurements, and the
     row shifts while the ₹/sq.ft caption settles, reporting an overlap that never existed on screen. */
  const [wordsBox, rateBox] = await page.evaluate(() => {
    const p = document.querySelector('input[data-err="price"]').closest('.min-w-0').querySelector('p');
    return [...p.children].map((c) => c.getBoundingClientRect().toJSON());
  });
  expect(Math.abs(wordsBox.y - rateBox.y)).toBeLessThan(2);
  expect(wordsBox.right).toBeLessThanOrEqual(rateBox.left);
  await expect(page.getByText('Allow buyers to negotiate the price')).toHaveCount(0);
  await expect(page.getByText('Sale Type', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Possession Status *')).toBeVisible();
  await expect(page.getByText(/Monthly Maintenance/i)).toBeVisible();
});

test('Possession options are equal side-by-side pills (2-col grid)', async ({ page }) => {
  await gotoPricing(page);
  const possession = page.locator('[data-err="possession"]');
  await expect(possession.locator('.grid.grid-cols-2')).toHaveCount(1);
  await possession.getByText('Under Construction', { exact: true }).click();
  await expect(possession.locator('[data-err="availableFrom"]')).toBeVisible();
});

test('ownership proof is optional to post', async ({ page }) => {
  await gotoUploadsBuy(page);

  // The label is the document's own name; the sentence beside it is what makes it optional.
  await expect(page.locator('[data-err="Index II"]').getByText('Index II', { exact: true })).toBeVisible();
  /* Matched on the optional-ness clause alone, not the whole paragraph: the sentence before it is
     chosen by `form.deal`, so pinning the pair would make this buy-only assertion fail on rent for
     a reason that has nothing to do with whether a document is required. */
  await expect(page.getByText('These are optional for publishing.')).toBeVisible();

  // Submitting with no document raises no document error — photos are the only hard requirement.
  await page.getByRole('button', { name: /Submit Property/i }).click();
  // The photo error proves validation ran before checking the absence of a document error.
  await expect(page.locator('[data-err="photos"] label.upload-zone')).toHaveClass(/dz-invalid/);
  await expect(page.locator('[data-err="documents"]')).toHaveCount(0);
});

test('documents section has no redundant trust copy', async ({ page }) => {
  await gotoUploadsBuy(page);
  await expect(page.getByText('Why we ask for documents')).toHaveCount(0);
  await expect(page.getByText(/Digitally signed PDFs are not supported/)).toHaveCount(0);
});

test('photo upload is compulsory: submitting with no photo flags the upload zone', async ({ page }) => {
  await gotoUploadsBuy(page);
  await page.getByRole('button', { name: /Submit Property/i }).click();
  const zone = page.locator('[data-err="photos"]');
  await expect(zone).toHaveCount(1);
  await expect(zone.locator('label.upload-zone')).toHaveClass(/dz-invalid/);
  await expect(zone.locator('p.dz-field-error')).toBeVisible();
  await expect(zone.getByText('Property Photos *')).toBeVisible();
});

test('uploading photos clears the compulsory-photo error', async ({ page }) => {
  await gotoUploadsBuy(page);
  await page.getByRole('button', { name: /Submit Property/i }).click();
  const zone = page.locator('[data-err="photos"]');
  await expect(zone.locator('label.upload-zone')).toHaveClass(/dz-invalid/);
  // Isolate the gallery picker from the camera input; canvas-generated bytes exercise real decoding.
  await uploadPublishablePhotos(page);
  // Thumbnails prove the files reached state; absence of an error alone would pass without an upload.
  await expect(zone.locator('.grid img')).toHaveCount(3);
  await expect(zone.locator('p.dz-field-error')).toHaveCount(0);
});
