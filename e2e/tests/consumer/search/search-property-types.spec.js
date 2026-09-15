import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* Postgres fixtures, not injected rows: nothing under a live `property` domain reads a doctored
   localStorage store. All four are approved Buy listings in Baner with featured=true, which pins
   them to page 1 — the backend clamps `size` to 100, so "absent" and "on page 2" look alike. */
const HOUSE = 'p5130'; // Independent House
const PLOT = 'p5131';  // Open Plot, land_use='commercial'
const FARM = 'p5132';  // Farm Land, land_use='agricultural'
const NOPHOTO = 'p5133'; // Flat with images='[]' and cover_image NULL

/* The six canonical "Post a property" types, and the filter keys they should
   map to across the home search + listings filter. */
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

test('home Buy search offers all six posted property types', async ({ page }) => {
  const errors = trackErrors(page);
  await openHomeType(page);
  for (const [label] of BUY_TYPES) {
    // Scope to the Type dropdown options — the hero also has a "Browse" quick-link
    // row where "Commercial" appears as a page-level chip.
    await expect(page.locator('.search-dd-opt', { hasText: label })).toBeVisible();
  }
  expect(errors).toHaveLength(0);
});

test('home Rent search offers share types plus posted types', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'Rent', exact: true }).click();
  await page.getByRole('button', { name: 'Type', exact: true }).click();
  for (const label of ['Flat', 'Independent House', 'Villa', 'Shared Room', 'Commercial', 'Open Plot', 'Farm Land']) {
    await expect(page.locator('.search-dd-opt', { hasText: label })).toBeVisible();
  }
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
    // The matching type shows as an active-filter chip (Property Type is now a dropdown).
    await expect(page.getByRole('button', { name: new RegExp('Remove filter ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })).toBeVisible();
  }
  expect(errors).toHaveLength(0);
});

test('listings filter renders the full canonical type set for Buy and Rent', async ({ page }) => {
  const errors = trackErrors(page);
  const filters = page.locator('aside:has(h3:has-text("Filters"))');
  await page.goto(`${BASE}/listings?deal=buy`);
  await filters.getByRole('button', { name: 'Property type', exact: true }).click();
  for (const [label] of BUY_TYPES) {
    await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
  }
  await page.goto(`${BASE}/listings?deal=rent`);
  await filters.getByRole('button', { name: 'Property type', exact: true }).click();
  for (const label of ['Shared Room']) {
    await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
  }
  expect(errors).toHaveLength(0);
});

test('posted properties (Independent House / Open Plot / Farm Land) are searchable', async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto(`${BASE}/listings?deal=buy`);
  const filters = page.locator('aside:has(h3:has-text("Filters"))');
  await filters.getByRole('button', { name: 'Property type', exact: true }).waitFor();
  await expect(page.locator(`a[href="/property/${HOUSE}"]`)).toBeVisible({ timeout: 15000 });

  // Select the three type filters (OR-combined) via the Property Type dropdown.
  // The dropdown auto-closes after each pick, so reopen it before every option.
  for (const label of ['Independent House', 'Open Plot', 'Farm Land']) {
    await filters.getByRole('button', { name: 'Property type', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
  }

  await expect(page.locator(`a[href="/property/${HOUSE}"]`)).toBeVisible({ timeout: 15000 });
  await expect(page.locator(`a[href="/property/${PLOT}"]`)).toBeVisible({ timeout: 15000 });
  await expect(page.locator(`a[href="/property/${FARM}"]`)).toBeVisible({ timeout: 15000 });

  // The three filters are OR-combined, so asserting a Villa is gone separates "the filter selected
  // these" from "these were on the page anyway".
  await expect(page.locator('a[href="/property/p5010"]')).toHaveCount(0);
  expect(errors).toHaveLength(0);
});

// `<img src="">` makes the browser re-download the whole HTML page as a photo per card, so assert
// the empty image box rather than just the absence of a bad `<img>` or a suppressed React warning.
test('a photoless listing renders no img at all, not an empty src', async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto(`${BASE}/listings?deal=buy`);
  const card = page.locator(`a[href="/property/${NOPHOTO}"]`);
  await expect(card).toBeVisible({ timeout: 15000 });

  // The photoless tile keeps its image box, but as a plain element with no source.
  await expect(card.locator('.img-empty')).toBeVisible();
  await expect(card.locator('img')).toHaveCount(0);
  // Nothing anywhere on the results page asks the browser for "".
  await expect(page.locator('img[src=""]')).toHaveCount(0);
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
  // Buy is the default tab. Pick two localities...
  await addHomeLoc(page, 'Baner');
  await addHomeLoc(page, 'Wakad');
  // ...and a BHK.
  await page.getByRole('button', { name: 'BHK', exact: true }).click();
  await page.getByRole('button', { name: '2 BHK', exact: true }).click();
  await page.getByRole('button', { name: 'Search' }).click();

  await page.waitForURL(/\/listings\?/);
  const url = decodeURIComponent(page.url());
  // Locality tokens serialize to lowercase slugs in the URL (display names stay
  // capitalized in the filter chips below).
  expect(url).toContain('loc=baner,wakad');
  expect(url).toContain('bhk=2');

  // Both localities are pre-applied in the filter panel (shown as active chips).
  await expect(page.getByRole('button', { name: /Remove filter Baner/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Remove filter Wakad/i })).toBeVisible();
  // The BHK filter carried over — shown as an active filter chip in the listings panel.
  await expect(page.getByRole('button', { name: /Remove filter 2 BHK/i })).toBeVisible();
  expect(errors).toHaveLength(0);
});

test('home typed known locality (no chip picked) is promoted to a loc= filter', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${BASE}/`);
  // Type a known locality but do NOT pick a suggestion chip. The app promotes the
  // best registry match to a real loc= filter (stronger than a raw ?q= text search).
  const input = page.locator('.hero-search-wrap input[type="text"]').first();
  await input.click();
  await input.fill('Baner');
  await page.getByRole('button', { name: 'Search' }).click();

  await page.waitForURL(/\/listings\?/);
  const url = decodeURIComponent(page.url());
  expect(url).toContain('loc=baner');
  await expect(page.getByRole('button', { name: /Remove filter Baner/i })).toBeVisible();
  expect(errors).toHaveLength(0);
});

test('home free-typed non-registry text falls back to a q= search query', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${BASE}/`);
  // Free text that matches no registry locality/society/landmark stays as a raw ?q= query.
  const input = page.locator('.hero-search-wrap input[type="text"]').first();
  await input.click();
  await input.fill('Zzqwerty Nowhere');
  await page.getByRole('button', { name: 'Search' }).click();

  await page.waitForURL(/\/listings\?/);
  const url = decodeURIComponent(page.url());
  expect(url).toContain('q=Zzqwerty');
  expect(url).not.toContain('loc=');
  expect(errors).toHaveLength(0);
});

test('home Rent Shared Room search carries locality + gender into the flatmates filters', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'Rent', exact: true }).click();
  // Pick the Shared Room property type...
  await page.getByRole('button', { name: 'Type', exact: true }).click();
  await page.getByRole('button', { name: 'Shared Room', exact: true }).click();
  // ...a locality...
  await addHomeLoc(page, 'Baner');
  // ...and a gender preference.
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




