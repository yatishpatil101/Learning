/* Reels feed against the live API: one `/properties/reels` read carries each reel's first five photos,
 * so the feed opens no detail request; `/properties` cards carry neither the gallery nor a count. */
import { test, expect } from '../../fixtures/live.js';
import { API } from '../../helpers/liveAuth.js';

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 5;

test('cards ship neither the gallery nor a photo count', async () => {
  const page = await (await fetch(`${API}/properties?size=200`)).json();
  expect(page.content.length).toBeGreaterThan(0);
  for (const row of page.content) {
    expect(row.images, `${row.title}`).toBeUndefined();
    expect(row.imageCount, `${row.title}`).toBeUndefined();
  }
});

test('a reel carries between three and five photos, the first of its real gallery', async () => {
  const reels = await (await fetch(`${API}/properties/reels?minPhotos=${MIN_PHOTOS}`)).json();
  expect(reels.length, 'the seeded catalogue has reel-eligible homes').toBeGreaterThan(0);
  for (const r of reels.slice(0, 3)) {
    expect(r.photos.length).toBeGreaterThanOrEqual(MIN_PHOTOS);
    expect(r.photos.length).toBeLessThanOrEqual(MAX_PHOTOS);
    expect(r.status).toBeUndefined();
    expect(r.lat).toBeUndefined();
    const detail = await (await fetch(`${API}/properties/${r.id}`)).json();
    expect(r.photos).toEqual(detail.images.slice(0, MAX_PHOTOS));
  }
});

test('the feed is one reels read and no detail reads, and the reel in view holds its frames', async ({ page }) => {
  const reads = [];
  page.on('request', (r) => { if (r.url().includes('/api/properties')) reads.push(new URL(r.url()).pathname); });
  await page.goto('/reels');
  await expect(page.getByRole('link', { name: /View home/i }).first()).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => page.locator('.reel').first().locator('.reel-slide').count())
    .toBeGreaterThanOrEqual(MIN_PHOTOS);
  await page.waitForLoadState('networkidle');

  expect(reads.filter((p) => p.endsWith('/properties/reels')), reads.join('\n')).toHaveLength(1);
  expect(reads.filter((p) => /\/properties\/[^/]+$/.test(p) && !p.endsWith('/reels')), reads.join('\n')).toEqual([]);
});