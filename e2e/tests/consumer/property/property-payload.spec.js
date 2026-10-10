import { test, expect } from '../../../fixtures/live.js';

const INTERNAL = ['recheckPending', 'recheckReason', 'recheckRequestedAt', 'archived', 'featured', 'qualityScore',
  'societyId', 'pincode', 'flagReason', 'formDetails'];
const COMPARE = ['id', 'slug', 'deal', 'propertyType', 'bhk', 'price', 'area', 'areaUnit', 'furnishing', 'possession',
  'reraId', 'amenities', 'locality', 'city', 'coverImage'];

const SIMILAR = ['id', 'slug', 'title', 'deal', 'propertyType', 'bhk', 'price', 'area', 'locality', 'city', 'coverImage',
  'reraId', 'ownerVerified', 'distanceKm'];
const OFF_CARD = ['priceUnit', 'imageCount', 'images', 'societySlug', 'societyName', 'floor', 'totalFloors', 'ageYears',
  'facing', 'qualityScore', 'freshness', 'lastConfirmedAt', 'owner', 'ownerId'];

const isGet = (r, test) => r.request().method() === 'GET' && test(new URL(r.url()).pathname);

test('a stranger’s listing detail carries no listing-internal state', async ({ page, consoleErrors }) => {
  const detail = page.waitForResponse((r) => isGet(r, (p) => p === '/api/properties/p5013'));
  await page.goto('/property/p5013');
  const body = await (await detail).json();
  expect(body.status).toBe('approved');
  expect(INTERNAL.filter((k) => k in body)).toEqual([]);
  await expect(page.locator('h1').first()).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('compare resolves every column in one slim read', async ({ page, consoleErrors }) => {
  await page.addInitScript(() => localStorage.setItem('draazyCompare', JSON.stringify(['p5013', 'p5121'])));
  const details = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (/^\/api\/properties\/[^/]+$/.test(path) && path !== '/api/properties/compare') details.push(path);
  });
  const compare = page.waitForResponse((r) => isGet(r, (p) => p === '/api/properties/compare'));
  await page.goto('/compare');
  const rows = await (await compare).json();
  expect(rows).toHaveLength(2);
  expect([...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !COMPARE.includes(k))).toEqual([]);
  await expect(page.locator('a[href="/property/p5121"]')).toBeVisible();
  expect(details).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('similar homes arrive ranked server-side, at most three slim rows', async ({ page, consoleErrors }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const similar = page.waitForResponse((r) => isGet(r, (p) => p === '/api/properties/similar'));
  await page.goto('/property/p5013');
  await expect(page.locator('h1').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const res = await similar;
  expect(new URL(res.url()).searchParams.get('deal')).toBeTruthy();
  const rows = await res.json();
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThanOrEqual(3);
  expect(rows.map((r) => r.slug)).not.toContain('p5013');
  expect([...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !SIMILAR.includes(k))).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('listing cards carry only what the card and map draw', async ({ page, consoleErrors }) => {
  const search = page.waitForResponse((r) => isGet(r, (p) => p === '/api/properties'));
  await page.goto('/listings');
  const { content } = await (await search).json();
  expect(content.length).toBeGreaterThan(0);
  expect(OFF_CARD.filter((k) => content.some((r) => k in r))).toEqual([]);
  await expect(page.locator('a[href^="/property/"]').first()).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
