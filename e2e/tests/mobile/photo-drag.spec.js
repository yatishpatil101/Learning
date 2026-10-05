import { test, expect } from '../../fixtures/live.js';
import { PHOTO_PNG, openPhotoStep } from '../../helpers/listingPhotos.helper.js';

const touch = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 0, radiusX: 6, radiusY: 6, force: 1 }];

async function swipe(cdp, from, to, { holdMs = 0 } = {}) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(from.x, from.y) });
  if (holdMs) await new Promise((resolve) => setTimeout(resolve, holdMs));
  for (let i = 1; i <= 12; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: touch(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + 40 });

test('photos reorder by press-and-hold drag on a phone, and a quick swipe does not move them', async ({ page }) => {
  let n = 0;
  await page.route('**/api/me/photos', (route) => {
    n += 1;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ url: `https://cdn.example.test/photo-${n}.jpg` }) });
  });
  await openPhotoStep(page);
  const photos = page.locator('[data-err="photos"]');
  await photos.locator('input[type="file"]').first().setInputFiles(Array.from({ length: 3 }, (_, i) => (
    { name: `room-${i}.png`, mimeType: 'image/png', buffer: PHOTO_PNG }
  )));
  await expect(photos.locator('img')).toHaveCount(3);
  await expect(photos).toHaveAttribute('aria-busy', 'false');
  await expect(photos.getByRole('button', { name: /^move photo/i })).toHaveCount(0);
  await expect(photos).toContainText('Press and hold a photo');

  const tiles = photos.getByRole('group', { name: /^Photo \d of 3$/ });
  await tiles.nth(2).scrollIntoViewIfNeeded();
  const order = () => photos.locator('img').evaluateAll((imgs) => imgs.map((img) => img.src.match(/photo-(\d)/)[1]).join(''));
  const before = await order();
  const cdp = await page.context().newCDPSession(page);

  await swipe(cdp, centre(await tiles.nth(1).boundingBox()), centre(await tiles.first().boundingBox()));
  expect(await order()).toBe(before);

  await swipe(cdp, centre(await tiles.nth(2).boundingBox()), centre(await tiles.first().boundingBox()), { holdMs: 400 });
  await expect.poll(order).toBe(before[2] + before[0] + before[1]);
});
