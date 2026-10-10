import { test, expect } from '../../../fixtures/live.js';
import { API } from '../../../helpers/liveAuth.js';

/* The home page receives only the fields it draws: slim cards, slim society tiles, a key-only
   saved list and no shell reads for alerts, follows or identity. */

const CARD = ['id', 'slug', 'title', 'deal', 'propertyType', 'bhk', 'price', 'area', 'locality', 'city',
  'coverImage', 'ownerVerified', 'ownershipVerified'];
const SOCIETY = ['slug', 'name', 'localitySlug', 'listingCount'];
const INDEX = ['deal', 'locality', 'localitySlug', 'societySlug', 'societyName', 'lat', 'lng'];
const LAZY = ['/api/me/saved-searches', '/api/me/societies/following', '/api/me/verification/identity', '/api/me/saved'];
const PUBLIC_FLAGS = ['mapSearch', 'scheduleVisit', 'reviewsEnabled', 'inAppMessaging', 'assistant', 'kycBadgeEnabled',
  'subscriptionPlans', 'referralRewards', 'signupsEnabled', 'maintenanceMode'];

const extraKeys = (rows, allowed) => [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !allowed.includes(k));
const onPath = (page, path) => page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().method() === 'GET');

test('guest home cards, society tiles and the search index carry only drawn fields', async ({ page, consoleErrors }) => {
  const featured = onPath(page, '/api/properties/featured');
  await page.goto('/');

  const { flags } = await (await fetch(`${API}/bootstrap`)).json();
  expect(Object.keys(flags).filter((k) => !PUBLIC_FLAGS.includes(k))).toEqual([]);
  const cards = await (await featured).json();
  expect(cards.length).toBeGreaterThan(0);
  expect(extraKeys(cards, CARD)).toEqual([]);

  const top = onPath(page, '/api/societies/top');
  await page.locator('section').filter({ hasText: 'Explore Pune societies' }).last().scrollIntoViewIfNeeded();
  expect(extraKeys(await (await top).json(), SOCIETY)).toEqual([]);

  const index = onPath(page, '/api/properties/search-index');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('input[role="combobox"]').first().click();
  const rows = await (await index).json();
  expect(rows.length).toBeGreaterThan(0);
  expect(extraKeys(rows, INDEX)).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('signed-in home boots from a slim /me/bootstrap and defers screen-only reads', async ({ page, login, consoleErrors }) => {
  await login.asBuyer();
  const paths = new Set();
  page.on('request', (r) => { if (r.method() === 'GET') paths.add(new URL(r.url()).pathname); });
  const boot = onPath(page, '/api/me/bootstrap');
  await page.goto('/');

  const doc = await (await boot).json();
  expect(Object.keys(doc).sort()).toEqual(['me', 'messagesUnread', 'notificationsUnread', 'saved', 'subscription']);
  expect(extraKeys(doc.saved, ['id', 'slug'])).toEqual([]);
  expect(doc.me.passwordHash).toBeUndefined();
  expect(doc.me.mobileVerified).toBeUndefined();
  await expect(page.locator('h1').first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(LAZY.filter((p) => paths.has(p))).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
