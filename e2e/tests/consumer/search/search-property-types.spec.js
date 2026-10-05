import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const HOUSE = 'p5130'; // Independent House
const PLOT = 'p5131';  // Open Plot, land_use='commercial'
const FARM = 'p5132';  // Farm Land, land_use='agricultural'
const NOPHOTO = 'p5133'; // Flat with images='[]' and cover_image NULL

const BUY_TYPES = [
  ['Flat', 'flat'],
  ['Independent House', 'house'],
  ['Villa', 'villa'],
  ['Commercial', 'commercial'],
  ['Open Plot', 'plot'],
  ['Farm Land', 'farmland'],
];

async function openHomeType(page) {
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Type', exact: true }).click();
}

test('Buy and Rent type options: home search and listings filters offer the canonical posted types', async ({ page }) => {
  const errors = trackErrors(page);
  const filters = page.locator('aside:has(h3:has-text("Filters"))');

  await test.step('home Buy search offers all six posted property types', async () => {
    await openHomeType(page);
    for (const [label] of BUY_TYPES) {
      await expect(page.locator('.search-dd-opt', { hasText: label })).toBeVisible();
    }
  });

  await test.step('home Rent search offers share types plus posted types', async () => {
    await page.goto(`${BASE}/`);
    await page.getByRole('button', { name: 'Rent', exact: true }).click();
    await page.getByRole('button', { name: 'Type', exact: true }).click();
    for (const label of ['Flat', 'Independent House', 'Villa', 'Shared Room', 'Commercial', 'Open Plot', 'Farm Land']) {
      await expect(page.locator('.search-dd-opt', { hasText: label })).toBeVisible();
    }
  });

  await test.step('listings filter renders the full canonical type set for Buy and Rent', async () => {
    await page.goto(`${BASE}/listings?deal=buy`);
    for (const [label] of BUY_TYPES) {
      await expect(filters.locator('label', { hasText: new RegExp(`^${label}$`) })).toBeVisible();
    }
    await page.goto(`${BASE}/listings?deal=rent`);
    await expect(filters.locator('label[for$="type-flatmates"]')).toHaveText('Shared Room');
  });

  expect(errors).toHaveLength(0);
});

test('each home Buy type deep-links to listings with the matching filter pre-selected', async ({ page }) => {
  // Six sequential full search flows — grant extra time so it survives parallel-load contention.
  test.slow();
  const errors = trackErrors(page);
  for (const [label, key] of BUY_TYPES) {
    await openHomeType(page);
    await page.locator('.search-dd-opt', { hasText: label }).click();
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForURL(/\/listings\?/);
    const url = page.url();
    expect(url).toContain(`ptype=${key}`);
    expect(url).toContain('deal=buy');
    await expect(page.getByRole('button', { name: new RegExp('Remove filter ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })).toBeVisible();
  }
  expect(errors).toHaveLength(0);
});

test('listings show posted properties (Independent House / Open Plot / Farm Land) via the type filter, and a photoless listing renders no img', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${BASE}/listings?deal=buy`);
  const filters = page.locator('aside:has(h3:has-text("Filters"))');

  await test.step('a photoless listing renders no img at all, not an empty src', async () => {
    // `<img src="">` makes the browser re-download the whole HTML page as a photo per card, so assert
    // the empty image box rather than just the absence of a bad `<img>` or a suppressed React warning.
    const card = page.locator(`a[href="/property/${NOPHOTO}"]`);
    await expect(card).toBeVisible({ timeout: 15000 });

    await expect(card.locator('.img-empty')).toBeVisible();
    await expect(card.locator('img')).toHaveCount(0);
    // Nothing anywhere on the results page asks the browser for "".
    await expect(page.locator('img[src=""]')).toHaveCount(0);
  });

  await test.step('posted properties (Independent House / Open Plot / Farm Land) are searchable', async () => {
    await filters.locator('label[for$="type-house"]').waitFor();
    await expect(page.locator(`a[href="/property/${HOUSE}"]`)).toBeVisible({ timeout: 15000 });

    for (const key of ['house', 'plot', 'farmland']) {
      await filters.locator(`label[for$="type-${key}"]`).click();
    }

    await expect(page.locator(`a[href="/property/${HOUSE}"]`)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`a[href="/property/${PLOT}"]`)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`a[href="/property/${FARM}"]`)).toBeVisible({ timeout: 15000 });
    // The three filters are OR-combined, so asserting a Villa is gone separates "the filter selected
    // these" from "these were on the page anyway".
    await expect(page.locator('a[href="/property/p5010"]')).toHaveCount(0);
  });

  expect(errors).toHaveLength(0);
});

async function addHomeLoc(page, name) {
  const input = page.locator('.hero-search-wrap input[type="text"]').first();
  await input.click();
  await input.fill(name);
  await page.locator('.loc-sugg', { hasText: name }).first().click();
}

test('home locality + BHK selection carries into the listings filters', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${BASE}/`);
  await addHomeLoc(page, 'Baner');
  await addHomeLoc(page, 'Wakad');
  await page.getByRole('button', { name: 'BHK', exact: true }).click();
  await page.getByRole('button', { name: '2 BHK', exact: true }).click();
  await page.getByRole('button', { name: 'Search' }).click();

  await page.waitForURL(/\/listings\?/);
  const url = decodeURIComponent(page.url());
  expect(url).toContain('loc=baner,wakad');
  expect(url).toContain('bhks=2');

  await expect(page.getByRole('button', { name: /Remove filter Baner/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Remove filter Wakad/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Remove filter 2 BHK/i })).toBeVisible();
  expect(errors).toHaveLength(0);
});

test('legacy bhk deep links still hydrate the listings filter', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${BASE}/listings?deal=buy&bhk=2&loc=baner`);

  await expect(page.getByRole('button', { name: /Remove filter 2 BHK/i })).toBeVisible({ timeout: 15000 });
  await expect.poll(() => new URL(page.url()).searchParams.get('bhks'), { timeout: 15000 }).toBe('2');
  expect(new URL(page.url()).searchParams.has('bhk')).toBe(false);
  expect(errors).toHaveLength(0);
});

test('home typed text: a known locality becomes loc=, anything else falls back to q=', async ({ page }) => {
  const errors = trackErrors(page);
  const typeAndSearch = async (text) => {
    await page.goto(`${BASE}/`);
    const input = page.locator('.hero-search-wrap input[type="text"]').first();
    await input.click();
    await input.fill(text);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForURL(/\/listings\?/);
    return decodeURIComponent(page.url());
  };

  await test.step('home typed known locality (no chip picked) is promoted to a loc= filter', async () => {
    expect(await typeAndSearch('Baner')).toContain('loc=baner');
    await expect(page.getByRole('button', { name: /Remove filter Baner/i })).toBeVisible();
  });

  await test.step('home free-typed non-registry text falls back to a q= search query', async () => {
    const url = await typeAndSearch('Zzqwerty Nowhere');
    expect(url).toContain('q=Zzqwerty');
    expect(url).not.toContain('loc=');
  });

  expect(errors).toHaveLength(0);
});

test('home Rent Shared Room search carries locality + gender into the flatmates filters', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'Rent', exact: true }).click();
  await page.getByRole('button', { name: 'Type', exact: true }).click();
  await page.getByRole('button', { name: 'Shared Room', exact: true }).click();
  await addHomeLoc(page, 'Baner');
  await page.getByRole('button', { name: 'Room for', exact: true }).click();
  await page.getByRole('button', { name: 'Women', exact: true }).click();
  await page.getByRole('button', { name: 'Search' }).click();

  await page.waitForURL(/\/flatmates\?/);
  const url = decodeURIComponent(page.url());
  expect(url).toContain('loc=Baner');
  expect(url).toContain('g=female');
  // The filter controls render twice (desktop grid + mobile drawer), so target the visible desktop
  // instance to avoid a strict-mode match on the off-screen drawer copy.
  await expect(page.getByRole('button', { name: 'Women', exact: true })).toHaveClass(/active/);
  await expect(page.locator('.dz-dropdown__value:visible', { hasText: 'Baner' }).first()).toBeVisible();
  expect(errors).toHaveLength(0);
});
