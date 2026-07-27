import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* PG / Hostel "Sharing" (occupancy) filter â€” a first-class type whose rooms are
   defined by sharing (single/double/â€¦) instead of BHK. PG is offered for BOTH
   rent and sale (an owner may sell the whole building), so the Sharing filter
   now applies on either deal.

   - selecting PG/Hostel reveals a "Sharing" group and hides the BHK group
   - the Room Type (flatmate) group stays hidden for PG
   - a ?sharing= deep-link pre-selects the option and renders a removable chip
   - picking a Sharing option (via the dropdown) narrows the results
   - PG is filterable by Sharing on the Buy deal too

   The Sharing control is a MultiSelect dropdown: its trigger lives in the
   sidebar, but the option list is portaled to <body>. Group/trigger assertions
   are scoped to the DESKTOP sidebar (the mobile drawer mounts off-screen and
   appears first in the DOM); option clicks target the portaled listbox. */

const BASE = 'http://localhost:5173';

/* The real seed DB, injected into localStorage BEFORE app JS runs so the mock
   API hydrates from a populated store (no async /api/__persist race). We append
   a deterministic set of approved PG listings so the Sharing filter has known,
   count-stable stock â€” mirroring search-property-types.spec.js. */
const SEED_DB = JSON.parse(
  readFileSync(new URL('../../frontend/src/data/db.json', import.meta.url), 'utf-8'),
);

const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const groupHeading = (page, name) => filters(page).locator('h4.fg-header').filter({ hasText: name });
const cards = (page) => page.locator('a[href^="/property/"]');
const sharingTrigger = (page) => filters(page).getByRole('button', { name: 'Sharing' });

/* An approved PG listing shaped exactly as the "Post a property" flow persists
   one: shareType 'pg' + a specific `sharing` occupancy. enrichRent preserves an
   authored shareType, so these keep their sharing key at runtime. `deal` lets a
   listing be a rental or an outright building sale. featured:true only pins these
   to page 1 under the real relevance sort (no visual effect on tiles); the Sharing
   sub-filter, not order, drives the "must be hidden" assertions. */
const pgListing = (id, sharing, deal = 'rent') => ({
  id, title: `PG (${sharing}) in Baner`, type: 'PG / Hostel', shareType: 'pg', sharing,
  room: 'shared', bhk: '', bhkNum: 0, bath: 0, area: 120, locality: 'Baner', localitySlug: 'baner',
  loc: 'Baner, Pune', society: '', deal,
  price: deal === 'buy' ? 4500000 : 9000,
  priceStr: deal === 'buy' ? '₹45,00,000' : '₹9,000/mo',
  owner: 'Seed Owner', ownerMobile: '9000000000', status: 'approved', statusClass: 'pill-approved',
  real: true, featured: true, views: 0, enquiries: 0, photoCount: 0, furnishing: 'furnished',
  facing: '', floor: 0, age: '', construction: 'ready', amenities: [], img: '', image: '',
  gallery: [], desc: '', deposit: deal === 'buy' ? 0 : 18000, pets: false, food: 'any', rera: '',
  lockin: '0', notice: '1', available: '', tenants: 'any', createdAt: Date.now(), viewUrl: `/property/${id}`,
});

async function injectStock(page, listings) {
  const db = { ...SEED_DB, listings: [...listings, ...(SEED_DB.listings || [])] };
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
      localStorage.setItem('puneNest_conciergeSeeded_v1', '1');
    },
    ['puneNestDB_v5', JSON.stringify(db)],
  );
}

test('PG/Hostel reveals the Sharing group and hides BHK + Room Type', async ({ page }) => {
  await page.goto(`${BASE}/listings?ptype=pg`);

  // Sharing (PG occupancy) group is shown...
  await expect(groupHeading(page, 'Sharing')).toBeVisible();
  // ...while BHK (meaningless for a PG) and the flatmate Room Type group are gone.
  await expect(groupHeading(page, 'BHK / Room Type')).toHaveCount(0);
  await expect(groupHeading(page, 'Room Type')).toHaveCount(0);
});

test('?sharing= deep-link pre-selects the option and shows a removable chip', async ({ page }) => {
  await page.goto(`${BASE}/listings?ptype=pg&sharing=double`);

  // The dropdown trigger reflects the deep-linked selection...
  await expect(sharingTrigger(page)).toContainText('Double Sharing');
  // ...and a removable chip confirms the active filter.
  await expect(page.getByRole('button', { name: /Remove filter Double Sharing/i })).toBeVisible();
});

test('picking a Sharing option narrows PG results', async ({ page }) => {
  await injectStock(page, [
    pgListing('SEED-pg-single-1', 'single'),
    pgListing('SEED-pg-single-2', 'single'),
    pgListing('SEED-pg-double-1', 'double'),
    pgListing('SEED-pg-double-2', 'double'),
    pgListing('SEED-pg-triple-1', 'triple'),
  ]);
  await page.goto(`${BASE}/listings?ptype=pg`);

  // Wait for our injected stock to hydrate and render.
  await expect(page.locator('a[href="/property/SEED-pg-single-1"]')).toBeVisible({ timeout: 15000 });
  const total = await cards(page).count();
  expect(total).toBeGreaterThan(1);

  // Open the Sharing dropdown and pick "Single (No Sharing)" from the portaled list.
  await sharingTrigger(page).click();
  await page.getByRole('option', { name: 'Single (No Sharing)' }).click();

  await expect(page.getByRole('button', { name: /Remove filter Single/i })).toBeVisible();
  await expect(page.locator('a[href="/property/SEED-pg-single-1"]')).toBeVisible({ timeout: 10000 });
  // The double/triple PGs must drop out.
  await expect(page.locator('a[href="/property/SEED-pg-double-1"]')).toHaveCount(0);
  const filtered = await cards(page).count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(total);
});

test('PG/Hostel is sellable and filterable by Sharing on the Buy deal', async ({ page }) => {
  await injectStock(page, [
    pgListing('SEED-pgbuy-single-1', 'single', 'buy'),
    pgListing('SEED-pgbuy-double-1', 'double', 'buy'),
    pgListing('SEED-pgbuy-double-2', 'double', 'buy'),
  ]);
  await page.goto(`${BASE}/listings?ptype=pg&deal=buy`);

  // A PG building for sale shows up under the Buy deal...
  await expect(page.locator('a[href="/property/SEED-pgbuy-single-1"]')).toBeVisible({ timeout: 15000 });
  const total = await cards(page).count();
  expect(total).toBeGreaterThan(1);

  // ...and the Sharing filter still narrows it (occupancy matters to a PG buyer too).
  await expect(groupHeading(page, 'Sharing')).toBeVisible();
  await sharingTrigger(page).click();
  await page.getByRole('option', { name: 'Double Sharing' }).click();

  await expect(page.getByRole('button', { name: /Remove filter Double Sharing/i })).toBeVisible();
  await expect(page.locator('a[href="/property/SEED-pgbuy-double-1"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('a[href="/property/SEED-pgbuy-single-1"]')).toHaveCount(0);
});

test('a PG offering multiple sharing types is found under each, and two picks return the union', async ({ page }) => {
  // pgA advertises BOTH single and double occupancy (authored as an array);
  // pgB is triple-only. This proves multi-value listings + multi-select filtering.
  await injectStock(page, [
    pgListing('SEED-pg-multi-A', ['single', 'double']),
    pgListing('SEED-pg-triple-B', ['triple']),
  ]);
  await page.goto(`${BASE}/listings?ptype=pg`);

  await expect(page.locator('a[href="/property/SEED-pg-multi-A"]')).toBeVisible({ timeout: 15000 });

  // Filter to Single: the multi-type PG matches (it offers single); the triple-only drops.
  await sharingTrigger(page).click();
  await page.getByRole('option', { name: 'Single (No Sharing)' }).click();
  await expect(page.locator('a[href="/property/SEED-pg-multi-A"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('a[href="/property/SEED-pg-triple-B"]')).toHaveCount(0);

  // Add Triple: now BOTH show (union of Single + Triple).
  await sharingTrigger(page).click();
  await page.getByRole('option', { name: 'Triple Sharing' }).click();
  await expect(page.getByRole('button', { name: /Remove filter Single/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Remove filter Triple Sharing/i })).toBeVisible();
  await expect(page.locator('a[href="/property/SEED-pg-multi-A"]')).toBeVisible();
  await expect(page.locator('a[href="/property/SEED-pg-triple-B"]')).toBeVisible({ timeout: 10000 });
});

