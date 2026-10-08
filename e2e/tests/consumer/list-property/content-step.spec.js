import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors, pickPossession } from '../../../helpers/listingForm.helper.js';
import { fillSociety } from '../../../helpers/places.js';
import { pickLocality } from '../../../helpers/locality.js';

async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

async function reachContentStep(page) {
  await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await pickType(page, 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('780');
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: 'Location', exact: true }).waitFor({ timeout: 10000 });
  await pickLocality(page, 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await fillSociety(page, 'Green Meadows');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  await page.locator('input[data-err="price"]').fill('5000000');
  await pickPossession(page);
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Photos & description').waitFor({ timeout: 10000 });
}

test('the content step: society amenities only, a factual description, YouTube link handling, and an owner-written headline', async ({ page }) => {
  test.slow();
  await reachContentStep(page);

  await test.step('offers only society amenities and writes a factual description', async () => {
      await expect(page.getByText('Society amenities')).toBeVisible();
      await expect(page.getByText('In-flat features')).toHaveCount(0);
      await expect(page.locator('.furn-tile', { hasText: 'Geyser' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Write it for me' }).click();
      await expect(page.locator('textarea[data-err="description"]')).toHaveValue(/BHK|flat/i);
  });

  await test.step('normalises supported YouTube links and rejects other video URLs', async () => {
      const field = page.locator('input[data-err="youtubeId"]');
      await field.fill('https://youtu.be/dQw4w9WgXcQ');
      await field.blur();
      await expect(field).toHaveValue('dQw4w9WgXcQ');
      await field.fill('https://vimeo.com/123');
      await page.getByRole('button', { name: /Submit Property/i }).click();
      await expect(page.getByText(/YouTube watch, shorts, or youtu\.be/i)).toBeVisible();
  });

  await test.step('lets the owner write the headline, offering the generated one as a suggestion', async () => {
      const headline = page.getByLabel('Headline');
      await expect(headline).toHaveAttribute('placeholder', /^\d BHK Flat in .+/);
      await page.getByRole('button', { name: 'Use suggestion' }).click();
      await expect(headline).toHaveValue(/^\d BHK Flat in .+/);
      await expect(page.getByRole('button', { name: 'Use suggestion' })).toHaveCount(0);
      await headline.fill('Sunny corner flat, call 9876543210');
      await page.getByRole('button', { name: /Submit Property/i }).click();
      await expect(headline).toHaveClass(/dz-invalid/);
  });
});
