import { test, expect } from '@playwright/test';
import { API } from '../../../helpers/liveAuth.js';

// Staged totals distinguish server-wide counts from the seeded page, while untouched data proves filtering.

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const header = (page) =>
  page.locator('p').filter({ hasText: /home[s]? with a room available|(person|people) look/ }).first();

const countsFrom = async (locator) => {
  const text = await locator.innerText();
  return {
    total: Number(text.match(/^\s*(\d+)/)?.[1]),
    verified: Number(text.match(/(\d+)\s+verified/)?.[1] ?? 0),
  };
};

// Facets mount inside the collapsed advanced grid.
const openFilters = async (page) => {
  const toggle = page.getByRole('button', { name: /^Filters/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
};

const openBoard = async (page) => {
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
};

// Pin page zero so staged totals retain content without altering the request the test observes.
const stageTotals = (page, { totalElements, totalPages }) =>
  page.route('**/flatmates/feed*', async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('page', '0');
    const response = await route.fetch({ url: url.toString() });
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, totalElements, totalPages } });
  });

test('the header counts the whole result set, not the cards on screen', async ({ page }) => {
  await stageTotals(page, { totalElements: 137, totalPages: 6 });
  await openBoard(page);

  const cards = await page.locator('.sf-card').count();
  expect(cards).toBeGreaterThan(0);
  expect(cards).toBeLessThan(137);

  const { total } = await countsFrom(header(page));
  expect(total).toBe(137);
});

test('the pager offers the server\'s page count and asks for the page the user clicked', async ({ page }) => {
  await stageTotals(page, { totalElements: 137, totalPages: 6 });
  await openBoard(page);

  await expect(page.getByRole('button', { name: 'Page 6' })).toBeVisible();

  // The UI is one-based but the request is zero-based, so this catches silent page skips.
  const next = page.waitForRequest((r) => /\/flatmates\/feed\?/.test(r.url()) && /[?&]page=1(&|$)/.test(r.url()));
  await page.getByRole('button', { name: 'Page 2' }).click();
  await next;

  await expect(page.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
});

test('Verified only narrows on the server, and lands on the verified count the header already showed', async ({ page }) => {
  await openBoard(page);
  await openFilters(page);

  const before = await countsFrom(header(page));
  expect(before.total).toBeGreaterThan(0);
  expect(before.verified).toBeGreaterThan(0);
  expect(before.verified).toBeLessThan(before.total);

  const narrowed = page.waitForRequest((r) => /\/flatmates\/feed\?/.test(r.url()) && /[?&]verifiedOnly=true(&|$)/.test(r.url()));
  await page.getByRole('button', { name: 'Verified only' }).click();
  await narrowed;

  // The verified facet must reach the same subset the header reports.
  await expect(header(page)).toHaveText(new RegExp(`^\\s*${before.verified}\\b`));
  const after = await countsFrom(header(page));
  expect(after.verified).toBe(before.verified);
});

test('an empty result set reports zero and shows no pager', async ({ page }) => {
  // Typing isolates the free-text query from Enter's smart-search parser.
  await openBoard(page);
  await page.getByPlaceholder(/^Try:/).fill('zzzznotasociety');

  await expect(header(page)).toHaveText(/^\s*0\b/);
  await expect(page.locator('.sf-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Page 1' })).toHaveCount(0);
});

// Request-level radius tests isolate SQL membership from the typeahead UI.

const feed = (request, params) =>
  request.get(`${API}/flatmates/feed`, { params }).then((r) => r.json());

test('a radius keeps the supply that has no coordinates of its own', async ({ request }) => {
  // This radius covers the seed, so equality exposes coordinate-less rows dropped by the predicate.
  const near = { nearLat: '18.5204', nearLng: '73.8567', nearRadiusKm: '25' };

  for (const tab of ['team-up', 'move-in']) {
    const all = await feed(request, { tab, size: '100' });
    const within = await feed(request, { tab, size: '100', ...near });
    expect(all.totalElements, `${tab} lane is seeded`).toBeGreaterThan(0);
    expect(within.totalElements, `${tab} keeps every seeded row inside 25km`).toBe(all.totalElements);
  }

  // `seatsTotal` is what marks a row as a group; counting them separately stops coordinate-bearing
  // rooms from masking a group the radius dropped.
  const groups = (await feed(request, { tab: 'team-up', size: '100', ...near }))
    .content.filter((row) => row.seatsTotal != null);
  expect(groups.length, 'groups survive a radius search').toBeGreaterThan(0);
});

test('a radius still narrows — it is a filter, not a formality', async ({ request }) => {
  // A small radius confirms the predicate narrows rather than admitting every row.
  const all = await feed(request, { tab: 'team-up', size: '100' });
  const near = await feed(request, {
    tab: 'team-up', size: '100', nearLat: '18.559', nearLng: '73.776', nearRadiusKm: '3',
  });

  expect(near.totalElements).toBeGreaterThan(0);
  expect(near.totalElements).toBeLessThan(all.totalElements);
  expect(near.verifiedElements).toBeLessThanOrEqual(near.totalElements);
});

test('a page past the end still reports the size of the set it is past the end of', async ({ request }) => {
  // Empty pages retain result-set totals so the pager can recover from an out-of-range page.
  const whole = await feed(request, { tab: 'team-up', size: '100' });
  const past = await feed(request, { tab: 'team-up', size: '5', page: '99' });

  expect(past.content).toHaveLength(0);
  expect(past.totalElements).toBe(whole.totalElements);
  expect(past.totalPages).toBeGreaterThan(0);
});
