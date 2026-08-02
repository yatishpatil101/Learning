import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';

/* The real seed DB the app ships with. We inject this (plus a few SEED-* rows)
   into localStorage BEFORE the app's JS runs, so the mock API hydrates from a
   populated store and never fires its async /api/__persist overwrite. This makes
   the seeded-search test fully deterministic (no reload race). */
const SEED_DB = JSON.parse(
  readFileSync(new URL('../../frontend/src/data/db.json', import.meta.url), 'utf-8'),
);

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

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function openHomeType(page) {
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('button', { name: 'Type', exact: true }).click();
}

test('home Buy search offers all six posted property types', async ({ page }) => {
  const errors = trackErrors(page);
  await openHomeType(page);
  for (const [label] of BUY_TYPES) {
    // Scope to the Type dropdown options â€” the hero also has a "Browse" quick-link
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
  for (const label of ['Flat', 'Independent House', 'Villa', 'PG / Hostel', 'Shared Room', 'Commercial', 'Open Plot', 'Farm Land']) {
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
  for (const label of ['PG / Hostel', 'Shared Room']) {
    await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
  }
  expect(errors).toHaveLength(0);
});

test('posted properties (Independent House / Open Plot / Farm Land) are searchable', async ({ page }) => {
  const errors = trackErrors(page);

  // Build a complete DB (the app's real seed + three approved listings shaped
  // exactly as the "Post a property" flow persists them) and inject it into
  // localStorage BEFORE any app JS runs. Because the store is already populated,
  // the mock API's hydration path returns early and never runs the async
  // /api/__persist fetch that could otherwise race and wipe our seed. Fully
  // deterministic: one navigation, no reload.
  const base = (over) => ({
    bhk: '', bhkNum: 0, bath: 0, locality: 'Baner', localitySlug: 'baner',
    loc: 'Baner, Pune', society: '', deal: 'buy', owner: 'Seed Owner', ownerMobile: '9000000000',
    status: 'approved', statusClass: 'pill-approved', real: true, featured: false, views: 0,
    enquiries: 0, photoCount: 0, furnishing: 'unfurnished', facing: '', floor: 0, age: '',
    construction: 'ready', amenities: [], img: '', image: '', gallery: [], desc: '',
    deposit: 0, pets: false, food: 'any', rera: '', lockin: '0', notice: '1', available: '',
    tenants: '', createdAt: Date.now(), ...over,
  });
  const db = { ...SEED_DB };
  // featured:true only pins these to page 1 under the real relevance sort (it has no
  // visual effect on tiles) so the type-filter assertions are deterministic.
  db.listings = [
    base({ id: 'SEED-house', title: '3 BHK Independent House in Baner', type: 'Independent House', bhk: '3 BHK', bhkNum: 3, bath: 2, area: 1500, price: 8000000, priceStr: '₹80 Lacs', viewUrl: '/property/SEED-house', featured: true }),
    base({ id: 'SEED-plot', title: 'Open Plot in Baner', type: 'Open Plot', area: 2400, price: 4500000, priceStr: '₹45 Lacs', viewUrl: '/property/SEED-plot', featured: true }),
    base({ id: 'SEED-farm', title: 'Farm Land in Baner', type: 'Farm Land', area: 5000, price: 3000000, priceStr: '₹30 Lacs', viewUrl: '/property/SEED-farm', featured: true }),
    ...(SEED_DB.listings || []),
  ];

  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
      // Skip the concierge demo seeder so it can't mutate/persist our store.
      localStorage.setItem('puneNest_conciergeSeeded_v1', '1');
    },
    ['puneNestDB_v5', JSON.stringify(db)],
  );

  await page.goto(`${BASE}/listings?deal=buy`);
  const filters = page.locator('aside:has(h3:has-text("Filters"))');
  await filters.getByRole('button', { name: 'Property type', exact: true }).waitFor();
  await expect(page.locator('a[href="/property/SEED-house"]')).toBeVisible({ timeout: 15000 });
  // Select the three new type filters (OR-combined) via the Property Type dropdown.
  // The dropdown auto-closes after each pick, so reopen it before every option.
  for (const label of ['Independent House', 'Open Plot', 'Farm Land']) {
    await filters.getByRole('button', { name: 'Property type', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
  }
  await expect(page.locator('a[href="/property/SEED-house"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('a[href="/property/SEED-plot"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('a[href="/property/SEED-farm"]')).toBeVisible({ timeout: 15000 });
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
  // The BHK filter carried over â€” shown as an active filter chip in the listings panel.
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

  // The flatmates page pre-applies both: the "Women" pill is active and the
  // locality dropdown shows Baner. The filter controls render twice (desktop grid
  // + mobile drawer), so target the visible desktop instance to avoid a
  // strict-mode match on the off-screen drawer copy.
  await expect(page.getByRole('button', { name: 'Women', exact: true })).toHaveClass(/active/);
  await expect(page.locator('.pn-dropdown__value:visible', { hasText: 'Baner' }).first()).toBeVisible();
  expect(errors).toHaveLength(0);
});




