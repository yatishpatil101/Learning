import { expect } from '@playwright/test';

/* A 16x16 PNG that survives the uploader's decode validation. Owned by a helper so every spec clearing the
   publish floor uploads the same bytes rather than a copy that drifts. */
export const PHOTO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=',
  'base64',
);

/** The two key categories the wizard demands coverage of before a home may publish. */
export const PUBLISH_CATEGORIES = ['Living Room', 'Kitchen'];

/* Clears what `validateStep3` demands before a new listing may be submitted. Waits on the media queue, not the
   picker's enabled state: the input is re-enabled a frame early and a pick in that window is dropped silently. */
export async function uploadPublishablePhotos(page, { count = 3, categories = PUBLISH_CATEGORIES } = {}) {
  const photos = page.locator('[data-err="photos"]');
  // Added to whatever is already there, so a spec can climb to the floor in stages.
  const before = await photos.locator('img').count();
  await photos.locator('label input[type="file"]').first()
    .setInputFiles(Array.from({ length: count }, (_, i) => (
      { name: `room-${before + i}.png`, mimeType: 'image/png', buffer: PHOTO_PNG }
    )));
  await expect(photos.locator('img')).toHaveCount(before + count);
  await expect(photos).toHaveAttribute('aria-busy', 'false');

  for (const [i, category] of categories.entries()) {
    await photos.locator('.dz-dd-photocat .dz-dropdown__trigger').nth(i).click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.getByRole('option', { name: category, exact: true }).click();
  }
}
