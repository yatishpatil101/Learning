import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { PHOTO_PNG } from '../../../helpers/listingPhotos.helper.js';

async function openRoomPhotoStep(page) {
  await signedInAsNew(page);
  await page.goto('/list-property?flatmate=1');
  await expect(page.locator('.lp-meter')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-err="bhk"] .radio-pill', { hasText: '2 BHK' }).click();
  await page.locator('[data-err="roomType"] .radio-pill', { hasText: 'Single (1 person)' }).click();
  await page.getByText('I have a registered rent agreement', { exact: true }).click();
  await page.getByLabel('Upload registered rent agreement for room').setInputFiles({
    name: 'agreement.png', mimeType: 'image/png', buffer: PHOTO_PNG,
  });
  await page.getByLabel('The owner knows and agrees to sharing').check();
  await page.getByRole('button', { name: /Next Step/i }).click();

  await page.locator('[data-err="locality"]').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: 'Baner' }).first().click();
  await page.locator('input[data-err="society"]').fill('Photo Limit Heights');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.getByText('Rent & move-in', { exact: true })).toBeVisible();
  await page.locator('input[data-err="rentShare"]').fill('13500');
  await pickDate(page, '[data-err="availableFrom"]', '2026-12-01');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.locator('[data-err="photos"]')).toBeVisible();
}

test.describe('flatmate room photo limit', () => {
  test('the room wizard follows the limit the server publishes and skips extra picks', async ({ page }) => {
    let photoId = 0;
    await page.route('**/api/bootstrap', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), listingPolicy: { maxPhotos: 4 } } });
    });
    await page.route('**/api/me/photos', (route) => {
      photoId += 1;
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ url: `https://cdn.example.test/room-limit-${photoId}.jpg` }),
      });
    });

    await openRoomPhotoStep(page);
    const photos = page.locator('[data-err="photos"]');
    const picker = photos.getByLabel('Add property photos', { exact: true });
    await expect(photos).toContainText('Up to 4 photos');
    await expect(photos).toContainText('0 / 4 photos');

    await picker.setInputFiles(Array.from({ length: 5 }, (_, i) => ({
      name: `room-${i}.png`, mimeType: 'image/png', buffer: PHOTO_PNG,
    })));
    await expect(photos.locator('.grid img')).toHaveCount(4);
    await expect(photos).toContainText('4 / 4 photos');
    await expect(picker).toBeDisabled();
  });
});
