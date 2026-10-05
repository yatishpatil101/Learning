import { crc32, deflateSync } from 'node:zlib';
import { expect } from '@playwright/test';
import { authHeaders, ownerIdOf, seedConsent, signedInAsNew } from './liveAuth.js';
import { LIST_PROPERTY_DRAFT_KEY } from './listingForm.helper.js';

const png = (width, height, pixelAt) => {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const rows = Array.from({ length: height }, (_, y) => Buffer.from([
    0, ...Array.from({ length: width }, (_, x) => pixelAt(x, y)),
  ]));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

export const PHOTO_PNG = png(640, 480, (x, y) => 120 + ((x + y) % 80));

// The two key categories the wizard demands coverage of before a home may publish.
export const PUBLISH_CATEGORIES = ['Living Room', 'Kitchen'];

export function uniquePhotoPng() {
  const blocks = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return png(640, 480, (x, y) => blocks[Math.floor(y / 120) * 4 + Math.floor(x / 160)]);
}

export async function openPhotoStep(page) {
  await seedConsent(page);
  const mobile = await signedInAsNew(page);
  const ownerId = ownerIdOf(await authHeaders(mobile));
  await page.evaluate(({ key, ownerId }) => localStorage.setItem(key, JSON.stringify({
    deal: 'rent', propertyType: 'flat', carpetArea: '900', bhk: '2', bathrooms: '2',
    floor: '9', totalFloors: '14',
    flatNumber: 'P-301', society: 'Photo UX Home', pincode: '411045',
    monthlyRent: '24000', deposit: '48000', availableFrom: '2026-12-01',
    __owner: ownerId,
  })), { key: LIST_PROPERTY_DRAFT_KEY, ownerId });
  await page.goto('/list-property');
  await expect(page.locator('.lp-steps')).toBeVisible();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.locator('[data-err="locality"] .dz-dropdown__trigger').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.getByRole('option', { name: 'Baner', exact: true }).click();
  await page.locator('input[data-err="society"]').fill('Photo UX Home');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.locator('[data-err="photos"]')).toBeVisible();
}

export async function uploadPublishablePhotos(page, { count = 3, categories = PUBLISH_CATEGORIES, buffer = PHOTO_PNG } = {}) {
  const photos = page.locator('[data-err="photos"]');
  // Added to whatever is already there, so a spec can climb to the floor in stages.
  const before = await photos.locator('img').count();
  await photos.getByLabel('Add property photos', { exact: true })
    .setInputFiles(Array.from({ length: count }, (_, i) => (
      { name: `room-${before + i}.png`, mimeType: 'image/png', buffer }
    )));
  await expect(photos.locator('img')).toHaveCount(before + count);
  await expect(photos).toHaveAttribute('aria-busy', 'false');

  for (const [i, category] of categories.entries()) {
    await photos.locator('.dz-dd-photocat .dz-dropdown__trigger').nth(i).click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.getByRole('option', { name: category, exact: true }).click();
  }
}
