import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { pickFloors, readListPropertyDraft, LIST_PROPERTY_DRAFT_KEY } from '../../../helpers/listingForm.helper.js';
import { uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function gotoFlow(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function completeDetails(page) {
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
}

async function completeLocation(page) {
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('A-1201');
  await page.locator('input[data-err="society"]').fill('Draft Residency');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.getByRole('heading', { name: /Price & terms/i })).toBeVisible();
}

async function completePricing(page) {
  await page.locator('input[data-err="monthlyRent"]').fill('32000');
  await page.locator('input[data-err="deposit"]').fill('64000');
  await pickDate(page, '[data-err="availableFrom"]', inDays(45));
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.getByRole('heading', { name: /Photos & description/i })).toBeVisible();
}

async function completeToPhotos(page) {
  await completeDetails(page);
  await completeLocation(page);
  await completePricing(page);
}

test('logout removes every saved form draft before another owner signs in, and a draft stamped by another account is not restored', async ({ page }) => {
  test.slow();
  await test.step('logout removes every saved form draft before another owner signs in', async () => {
    await gotoFlow(page);
    await page.locator('input[data-err="carpetArea"]').fill('1050');
    await expect.poll(() => readListPropertyDraft(page)).toContain('1050');
    await page.evaluate(() => {
      localStorage.setItem('dzDraft:rentAgreement', JSON.stringify({ tName: 'Previous tenant' }));
      localStorage.setItem('dzDraft:flatmate-post', JSON.stringify({ about: 'Previous owner' }));
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('button', { name: /log out/i }).click();
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('dzDraft:')))).toEqual([]);

    await gotoFlow(page);
    await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('');
  });

  await test.step('a draft stamped by another account is not restored', async () => {
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({
      deal: 'rent', propertyType: 'flat', carpetArea: '1777', __owner: 'someone-else',
    })), LIST_PROPERTY_DRAFT_KEY);
    await page.goto('/list-property');
    await page.waitForSelector('.lp-steps', { timeout: 20000 });
    await expect(page.locator('input[data-err="carpetArea"]')).not.toHaveValue('1777');
  });
});

test('uploaded photos and the current step restore after reload', async ({ page }) => {
  let photoId = 0;
  await page.route('**/api/me/photos', async (route) => {
    photoId += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: `https://cdn.example.test/list-property-${photoId}.jpg` }),
    });
  });
  await gotoFlow(page);
  await completeToPhotos(page);
  await uploadPublishablePhotos(page);
  await expect.poll(() => new URL(page.url()).searchParams.get('step')).toBe('4');
  await expect.poll(() => readListPropertyDraft(page)).toContain('list-property-3.jpg');

  await page.reload();
  await expect(page.getByRole('heading', { name: /Photos & description/i })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-err="photos"] img')).toHaveCount(3);
  await expect.poll(() => new URL(page.url()).searchParams.get('step')).toBe('4');
});

test('browser Back returns to the previous wizard step, and submitting without durable photo URLs does not add Unsplash fallbacks', async ({ page }) => {
  test.slow();
  await page.route('**/api/me/photos', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' }),
    });
  });
  await page.route('**/api/me/listings/duplicate-check', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ found: false }) });
  });
  let payload = null;
  await page.route('**/api/me/listings', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    payload = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'LP-no-unsplash', title: 'No fallback', propertyType: 'Flat', deal: 'rent', price: 32000, images: [] }),
    });
  });
  await gotoFlow(page);
  await completeDetails(page);
  await expect.poll(() => new URL(page.url()).searchParams.get('step')).toBe('2');

  await page.goBack();
  await expect(page.getByText('Property details', { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/list-property');

  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await completeLocation(page);
  await completePricing(page);
  await uploadPublishablePhotos(page);

  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect.poll(() => payload).not.toBeNull();
  expect(payload.images ?? []).toEqual([]);
  expect(JSON.stringify(payload)).not.toContain('images.unsplash.com');
});
