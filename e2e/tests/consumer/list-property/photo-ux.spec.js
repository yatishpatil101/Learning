import { test, expect } from '../../../fixtures/live.js';
import { LIST_PROPERTY_DRAFT_KEY } from '../../../helpers/listingForm.helper.js';
import { PHOTO_PNG, openPhotoStep as openPhotos } from '../../../helpers/listingPhotos.helper.js';

const SMALL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4AWJiYGD4D8IgBpBmYAAAAAD//7vS9wEAAAAGSURBVAMAGDACA6ybwrYAAAAASUVORK5CYII=', 'base64');

test.describe('list property photo UX', () => {
  test.beforeEach(async ({ page }) => {
    let photoId = 0;
    let active = 0;
    let maxActive = 0;
    await page.route('**/api/me/photos', async (route) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      photoId += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (maxActive > 3) {
        active -= 1;
        await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ message: 'too many uploads' }) });
        return;
      }
      active -= 1;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ url: `https://cdn.example.test/photo-${photoId}.jpg`, maxActive }),
      });
    });
  });

  test('the photo step: a single phone-friendly picker, cover and ordering, a short photo-type list, and a per-photo resolution error', async ({ page }) => {
    test.slow();
    await openPhotos(page);
    const photos = page.locator('[data-err="photos"]');
    const picker = photos.getByLabel('Add property photos', { exact: true });

    await test.step('offers a single picker that leaves the camera-or-library choice to the phone', async () => {
      await expect(photos.locator('label.upload-zone')).toHaveCount(1);
        await expect(picker).toHaveAttribute('multiple', '');
        await expect(picker).not.toHaveAttribute('capture', /.*/);
        await expect(photos.getByText('Take photo', { exact: true })).toHaveCount(0);
        await expect(photos).toContainText('Up to 10 photos');
        await expect(photos).toContainText('0 / 10 photos');
    });

    await test.step('sets cover, reorders by drag or keyboard, caps concurrent uploads at three and keeps photo bytes out of drafts', async () => {
      await expect(picker).toBeEnabled();
        await picker.setInputFiles(Array.from({ length: 4 }, (_, i) => ({
          name: `room-${i}.png`,
          mimeType: 'image/png',
          buffer: PHOTO_PNG,
        })));
        await expect(photos.locator('img')).toHaveCount(4);
        await expect(photos).toHaveAttribute('aria-busy', 'false');
        await expect(photos.getByRole('button', { name: /^move photo/i })).toHaveCount(0);
        await photos.getByRole('button', { name: /set as cover/i }).nth(1).click();
        await expect(photos.locator('img').first()).toHaveAttribute('src', /photo-3\.jpg/);

        const tiles = photos.getByRole('group', { name: /^Photo \d of 4$/ });
        await tiles.first().focus();
        await page.keyboard.press('Space');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Space');
        await expect(photos.locator('img').nth(1)).toHaveAttribute('src', /photo-3\.jpg/);

        const from = await tiles.nth(3).boundingBox();
        const to = await tiles.first().boundingBox();
        await page.mouse.move(from.x + from.width / 2, from.y + 30);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 12 });
        await page.mouse.up();
        await expect(photos.locator('img').first()).toHaveAttribute('src', /photo-4\.jpg/);
        await expect(photos.locator('img').nth(2)).toHaveAttribute('src', /photo-3\.jpg/);
        const draft = await page.evaluate((key) => localStorage.getItem(key), LIST_PROPERTY_DRAFT_KEY);
        expect(draft ?? '').not.toContain('data:');
    });

    await test.step('photo type is a short list you scroll, with no search box', async () => {
      await photos.locator('.dz-dd-photocat .dz-dropdown__trigger').first().click();
        const menu = page.locator('.dz-dropdown__menu.is-portal-open');
        await expect(menu.getByRole('option')).toHaveText(['Living Room', 'Kitchen', 'Bedroom', 'Bathroom', 'Balcony', 'Exterior / Building', 'Floor Plan', 'Other']);
        await expect(menu.locator('.dz-dropdown__search')).toHaveCount(0);
      await menu.getByRole('option', { name: 'Balcony', exact: true }).click();
      await expect(photos.locator('.dz-dd-photocat .dz-dropdown__trigger').first()).toHaveText('Balcony');
    });

    await test.step('shows a per-photo resolution error and retry affordance', async () => {
        await photos.locator('input[type="file"]').first().setInputFiles({
          name: 'tiny.png',
          mimeType: 'image/png',
          buffer: SMALL_PNG,
        });
        await expect(photos).toContainText(/480 px/);
        await expect(photos.getByRole('button', { name: /retry/i })).toBeVisible();
    });
  });

  test('follows the limit the server publishes rather than a bundled number', async ({ page }) => {
    await page.route('**/api/listing-policy', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ maxPhotos: 4 }),
    }));
    await openPhotos(page);
    const photos = page.locator('[data-err="photos"]');
    await expect(photos).toContainText('Up to 4 photos');
    await expect(photos).toContainText('0 / 4 photos');
    await photos.getByLabel('Add property photos', { exact: true }).setInputFiles(Array.from({ length: 5 }, (_, i) => ({
      name: `room-${i}.png`, mimeType: 'image/png', buffer: PHOTO_PNG,
    })));
    await expect(photos.locator('.grid img')).toHaveCount(4);
    await expect(photos).toContainText('4 / 4 photos');
    await expect(photos.getByLabel('Add property photos', { exact: true })).toBeDisabled();
  });
});
