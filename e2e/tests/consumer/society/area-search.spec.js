import { test, expect } from '@playwright/test';
import { uniqueMobile } from '../../../helpers/liveAuth.js';
import { mintPickableSociety, publishSocietyListing, retireListing } from '../../../helpers/liveSociety.js';
import { stubGooglePlaces } from '../../../helpers/places.js';

// Home area search: picking a named Google building asks the server whether it is a society; a hit with live homes for the deal
// becomes a society filter, anything else stays a near-a-place search.

const published = [];
test.afterEach(async () => {
  for (const id of published.splice(0)) await retireListing(id);
});

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const HERO = '.hero-search-wrap';
const INPUT = `${HERO} input[aria-label="Search localities, societies or landmarks"]`;
const PIN = { lat: 18.5975, lng: 73.7701 };
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function openSearch(page, stub) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/`);
  await page.locator(HERO).waitFor({ timeout: 15000 });
  await stubGooglePlaces(page, stub);
}

async function pickPlace(page, name) {
  await page.locator(INPUT).fill(name);
  // `--stack` marks a Google place row; a society that holds homes is also offered from the index, and
  // that row skips the resolve this spec is about.
  await page.locator(`${HERO} .loc-sugg--stack`, { hasText: name }).first().click();
}

function watchResolve(page) {
  const calls = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() === 'GET' && u.pathname === '/api/societies/resolve') calls.push(u.searchParams.get('placeId'));
  });
  return calls;
}

test('a Google place that is a society with live homes becomes a society filter, not a near-a-place search', async ({ page }) => {
  // Google's name for the building differs from the society's, so the pick is not shadowed by the
  // society row the index already offers for the same text.
  const u = uniq();
  const name = `Zz Area ${u} Heights`;
  const placeName = `Zz Gmaps ${u} Tower`;
  const slug = await mintPickableSociety(uniqueMobile(), name, { placeLabel: placeName });
  published.push(await publishSocietyListing(slug, name));
  const resolves = watchResolve(page);

  await openSearch(page, { ...PIN });
  await pickPlace(page, placeName);
  await expect(page.locator(`${HERO} .loc-chip`, { hasText: name })).toBeVisible();
  expect(resolves, 'the pick asked the server which society this place is').toHaveLength(1);

  await page.locator(`${HERO} .search-btn`).click();
  await page.waitForURL(/\/listings\?/, { timeout: 8000 });
  const sp = new URL(page.url()).searchParams;
  expect(sp.get('soc')).toBe(slug);
  expect(sp.get('near'), 'a society pick must not also add a proximity filter').toBeNull();
  await expect(page.locator('main').getByText(name).first()).toBeVisible({ timeout: 10000 });
});

test('a society with no live homes for the searched deal falls back to near-a-place', async ({ page }) => {
  const empty = `Zz Empty ${uniq()} Heights`;
  await mintPickableSociety(uniqueMobile(), empty);
  const rentOnly = `Zz RentOnly ${uniq()} Heights`;
  published.push(await publishSocietyListing(await mintPickableSociety(uniqueMobile(), rentOnly), rentOnly, { deal: 'rent' }));

  for (const name of [empty, rentOnly]) {
    await openSearch(page, { ...PIN });
    await pickPlace(page, name);
    await expect(page.locator(`${HERO} .loc-chip`, { hasText: name })).toBeVisible();

    await page.locator(`${HERO} .search-btn`).click();
    await page.waitForURL(/\/listings\?/, { timeout: 8000 });
    const sp = new URL(page.url()).searchParams;
    expect(sp.get('soc'), `${name} has nothing to show on the buy tab`).toBeNull();
    expect(sp.get('near')).toBe(`${PIN.lat},${PIN.lng}`);
    expect(sp.get('nearlabel')).toBe(name);
  }
});

test('a named building no society holds keeps the near-a-place search', async ({ page }) => {
  const name = `Zz Unclaimed ${uniq()} Court`;
  const resolves = watchResolve(page);

  await openSearch(page, { ...PIN });
  await pickPlace(page, name);
  await expect(page.locator(`${HERO} .loc-chip`, { hasText: name })).toBeVisible();
  expect(resolves).toHaveLength(1);

  await page.locator(`${HERO} .search-btn`).click();
  await page.waitForURL(/\/listings\?/, { timeout: 8000 });
  const sp = new URL(page.url()).searchParams;
  expect(sp.get('soc')).toBeNull();
  expect(sp.get('near')).toBe(`${PIN.lat},${PIN.lng}`);
  expect(sp.get('nearlabel')).toBe(name);
});

test('a place that is only an area or road is never looked up as a society', async ({ page }) => {
  const name = `Zz Road ${uniq()} Lane`;
  const resolves = watchResolve(page);

  await openSearch(page, { ...PIN, types: ['route'] });
  await pickPlace(page, name);
  await expect(page.locator(`${HERO} .loc-chip`, { hasText: name })).toBeVisible();

  await page.locator(`${HERO} .search-btn`).click();
  await page.waitForURL(/\/listings\?/, { timeout: 8000 });
  const sp = new URL(page.url()).searchParams;
  expect(sp.get('soc')).toBeNull();
  expect(sp.get('near')).toBe(`${PIN.lat},${PIN.lng}`);
  expect(resolves).toHaveLength(0);
});
