import { test, expect } from '@playwright/test';
import { API } from '../../../helpers/liveAuth.js';

/* The oracle haversines the *unfiltered* catalogue in this process — asking the API for the same
   filtered count would compare the same wrong SQL to itself. Counts are derived, never hard-coded. */

/** A point in the middle of the Wagholi flats cluster — the densest buy stock in the seed. */
const NEAR = '18.5746,73.9771';
const NEAR_LABEL = 'Wagholi Cluster';
/** Two localities far enough apart that a small circle can contain one and not the other. */
const LOCS = ['baner', 'wagholi'];

const haversineKm = (aLat, aLng, bLat, bLng) => {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/* Every approved listing for a deal, paginated: the server clamps `size` to 100, so reading
   `content.length` off one big page under-counts the day the seed outgrows the clamp. */
async function catalogue(deal) {
  const rows = [];
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`${API}/properties?deal=${deal}&size=100&page=${page}`);
    expect(res.ok, `GET /properties page ${page} -> ${res.status}`).toBe(true);
    const body = await res.json();
    rows.push(...(body.content || []));
    if (page + 1 >= (body.totalPages ?? 1)) break;
  }
  expect(rows.length, `the ${deal} catalogue is empty; the seed did not run`).toBeGreaterThan(0);
  return rows;
}

/** Count the rows a `loc` + `near` search should return, computed here rather than asked for. */
function oracle(rows, { locs = null, near = null, radiusKm = null } = {}) {
  let out = rows;
  if (locs) {
    const allowed = new Set(locs);
    out = out.filter((p) => allowed.has(p.localitySlug));
  }
  if (near) {
    const [lat, lng] = near.split(',').map(Number);
    out = out.filter((p) => p.lat != null && p.lng != null
      && haversineKm(lat, lng, p.lat, p.lng) <= radiusKm);
  }
  return out.length;
}

/* The "Showing N of M" total, once it describes the query on screen. Scoped to the visible copy
   (`.first()` picks the hidden mobile one) and read past `aria-busy`, since a refining grid keeps
   the previous results painted. `busyTimeout` is for callers wrapping this in `expect.poll`, where
   one busy grid would otherwise eat the whole poll budget inside a single iteration. */
async function shownCount(page, { busyTimeout = 15000 } = {}) {
  const line = page.locator('main p:visible', { hasText: /Showing/ }).first();
  await line.waitFor({ timeout: 15000 });
  await expect(line).not.toHaveAttribute('aria-busy', 'true', { timeout: busyTimeout });
  const text = await line.locator('span.text-teal-400').first().textContent();
  return Number(String(text).replace(/[^\d]/g, ''));
}

const listings = (params) => `/listings?${params}`;

test('the count on screen is the distance filter done right, checked against independent geometry', async ({ page }) => {
  const rows = await catalogue('buy');
  const expected = oracle(rows, { near: NEAR, radiusKm: 3 });
  // Without this the test would pass on a page that renders nothing for a broken filter.
  expect(expected, 'no seeded buy listing sits within 3km of the fixture point').toBeGreaterThan(0);

  await page.goto(listings(`deal=buy&near=${NEAR}&nearlabel=${encodeURIComponent(NEAR_LABEL)}&nearr=3`));
  expect(await shownCount(page)).toBe(expected);
});

test('a locality and a place intersect — neither filter quietly wins', async ({ page }) => {
  /* The failure this exists to catch is not "the filter is broken" but "the filter is the wrong
     set operation": a union would return more than either side, and a last-one-wins bug would
     return exactly one side's count. Both are indistinguishable from correct unless the three
     numbers are known to differ, so the differences are asserted before the page is opened. */
  const rows = await catalogue('buy');
  const locOnly = oracle(rows, { locs: LOCS });
  const nearOnly = oracle(rows, { near: NEAR, radiusKm: 5 });
  const both = oracle(rows, { locs: LOCS, near: NEAR, radiusKm: 5 });

  expect(both, 'the intersection is empty, so this proves nothing about AND').toBeGreaterThan(0);
  expect(both, `intersection (${both}) equals the locality filter alone (${locOnly}); the near `
    + 'filter excludes nothing here, so a page that ignored it would still pass').toBeLessThan(locOnly);
  expect(both, `intersection (${both}) equals the near filter alone (${nearOnly}); the locality `
    + 'filter excludes nothing here, so a page that ignored it would still pass').toBeLessThan(nearOnly);

  await page.goto(listings(
    `deal=buy&loc=${LOCS.join(',')}&near=${NEAR}&nearlabel=${encodeURIComponent(NEAR_LABEL)}&nearr=5`,
  ));
  expect(await shownCount(page), 'the two filters did not intersect').toBe(both);

  // Both constraints are visible as removable chips, so the user can see why the set is this small.
  await expect(page.locator('.af-chip', { hasText: /Wagholi Cluster/ }).first()).toBeVisible();
  await expect(page.locator('.af-chip', { hasText: /Baner/ }).first()).toBeVisible();
});

test('widening the radius can only add listings, never drop one', async ({ page }) => {
  const rows = await catalogue('buy');
  const near = (r) => oracle(rows, { near: NEAR, radiusKm: r });
  const small = near(3);
  const large = near(10);
  // A monotonicity claim between two equal numbers is true by accident; make the widening real.
  expect(large, `3km and 10km both match ${small} listings, so widening is untested here`)
    .toBeGreaterThan(small);

  const url = (r) => listings(`deal=buy&near=${NEAR}&nearlabel=${encodeURIComponent(NEAR_LABEL)}&nearr=${r}`);
  await page.goto(url(3));
  expect(await shownCount(page), 'the 3km page disagrees with the geometry').toBe(small);
  await page.goto(url(10));
  expect(await shownCount(page), 'the 10km page disagrees with the geometry').toBe(large);
});

test('commute mode reads the slider as minutes, not kilometres', async ({ page }) => {
  /* `nearmode=min` switches the radius slider from km to travel minutes, and the app converts at
     0.4 km per minute (facetQuery.js:191). So 15 on the slider is a 6 km circle, not a 15 km one —
     and the two are asserted to be different sizes first, because if the seed ever made them equal
     this test would pass whether the conversion happened or not. */
  const rows = await catalogue('buy');
  const asMinutes = oracle(rows, { near: NEAR, radiusKm: 15 * 0.4 });
  const asKm = oracle(rows, { near: NEAR, radiusKm: 15 });
  expect(asMinutes, 'a 6km circle and a 15km circle hold the same listings, so the conversion is '
    + 'unobservable in this seed').not.toBe(asKm);

  await page.goto(listings(
    `deal=buy&near=${NEAR}&nearlabel=${encodeURIComponent(NEAR_LABEL)}&nearr=15&nearmode=min`,
  ));
  expect(await shownCount(page), '15 minutes was treated as 15 kilometres').toBe(asMinutes);
});

test('a locality the registry knows but has no stock in says so, and offers a way out', async ({ page }) => {
  /* The anchor that stops this being vacuous: an unrecognised slug would also render an empty page,
     so "empty" only means anything once the slug is confirmed to be a real, active locality the
     registry simply has nothing in. */
  const res = await fetch(`${API}/localities`);
  expect(res.ok, `GET /localities -> ${res.status}`).toBe(true);
  const registry = await res.json();
  const list = Array.isArray(registry) ? registry : registry.content || [];
  expect(list.length, 'the locality registry is empty; the seed did not run').toBeGreaterThan(5);

  const empty = list.find((l) => l.active !== false && Number(l.listingCount) === 0);
  expect(empty, 'every locality in the registry has stock, so there is no empty state to show')
    .toBeTruthy();

  await page.goto(listings(`deal=buy&loc=${empty.slug}`));
  expect(await shownCount(page), `"${empty.slug}" reports stock the registry says it has none of`).toBe(0);
  await expect(page.getByText(/No properties found/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Search all localities/i }).first()).toBeVisible();
});

test('removing the locality chip broadens the results back to the whole catalogue', async ({ page }) => {
  const rows = await catalogue('buy');
  const banerOnly = oracle(rows, { locs: ['baner'] });
  const everything = rows.length;
  expect(banerOnly, 'Baner holds no buy stock, so removing its chip would broaden nothing')
    .toBeGreaterThan(0);
  expect(everything, 'Baner is the entire buy catalogue; removing the chip cannot broaden anything')
    .toBeGreaterThan(banerOnly);

  await page.goto(listings('deal=buy&loc=baner'));
  expect(await shownCount(page)).toBe(banerOnly);

  await page.locator('.af-chip', { hasText: 'Baner' }).first().click();

  /* Poll rather than read once: the chip strip renders from live filter state while the grid renders
     from the deferred copy, so the chip vanishes a render BEFORE the count moves and anchoring on
     its disappearance reads the stale number. The only honest anchor is the new count itself. */
  await expect.poll(() => shownCount(page, { busyTimeout: 2000 }), { timeout: 15000 }).toBe(everything);
});
