import { test, expect } from '@playwright/test';
import { API } from '../../../helpers/liveAuth.js';

/* Location search arithmetic, checked against an independent oracle.
 *
 * Replaces the count-checking half of `qa-location-search.spec.js`. That spec was a fifteen-scenario
 * sweep whose oracle was computed *inside the page* by importing `/src/lib/mockApi.js` — so it could
 * only ever exist in mock mode, and most of its scenarios have since been covered live elsewhere:
 *
 *   A, B, C, D, G (hero locality picks → ?loc=, BHK, Rent tab, free-text promotion)
 *        → `consumer/search/live-search-property-types.spec.js`
 *   E, F (society → ?soc= with parent ?loc=; landmark → ?near= with the never-dead-end invariant)
 *        → `consumer/home/live-entity-search.spec.js`
 *
 * What was left over is the part with real teeth and no live equivalent: **does the number on screen
 * match the geometry**, and does `loc` + `near` intersect rather than one of them quietly winning.
 * Those are H, I, J, K, L and M, and they are what this file keeps.
 *
 * ## Why an oracle at all, when the server could just be asked
 *
 * Asking the API for the same filtered count the page asked for proves only that the page rendered
 * the response — it cannot catch the server's own geometry being wrong, because both sides would be
 * the same wrong SQL. So the oracle here pulls the **unfiltered** catalogue and does the haversine
 * in this process. The page's number comes from a SQL distance clause; the expected number comes
 * from JavaScript trigonometry over each row's stored `lat`/`lng`. Two independent computations of
 * the same question, which is the only arrangement in which agreement means anything.
 *
 * ## Why nothing here is a hard-coded count
 *
 * Same reason as `live-server-side-search.spec.js`: other live specs (`live-post-on-behalf`,
 * `live-properties-moderation`, …) create approved listings while this one runs, so any number
 * written into the file is true alone and false in the suite. Every expected value is derived at
 * run time, and every comparison that could be satisfied by an accident is gated on the oracle
 * first showing the two sides genuinely differ.
 */

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

/**
 * Every approved listing for a deal, as the API states them.
 *
 * Paginated rather than trusting one big page: the server clamps `size` to 100, so a file that asks
 * for 500 and reads `content.length` would silently start under-counting the day the seed grows
 * past the clamp — and an oracle that under-counts makes the page look over-eager.
 */
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

/**
 * The "Showing N of M" total, once it describes the query on screen.
 *
 * Two things this has to survive. The line is rendered twice — a mobile copy and a desktop copy —
 * so it is scoped to the visible one; `.first()` alone picks the hidden mobile copy on a desktop
 * viewport and never resolves. And refining a search keeps the previous results painted for a
 * frame or two rather than flashing skeletons, which the page marks with `aria-busy`; reading
 * through that is how the mock version of this spec once compared a pre-filter count against a
 * filtered oracle and called it a mismatch.
 *
 * `busyTimeout` exists for the callers that wrap this in `expect.poll`. At the default, one busy
 * grid eats the whole poll budget inside a single iteration, so the poll gets one real attempt and
 * reports an `aria-busy` timeout instead of the "the count never reached N" the caller wanted.
 */
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

  /* Poll rather than read once. The chip strip renders from the live filter state while the grid
     renders from the *deferred* copy of it (`useDeferredValue`, listingsResultsPipeline.js:48),
     whose whole job is to paint the old result set one more time before the new one. So the chip
     is guaranteed to vanish a render BEFORE the count moves, and anchoring on the chip's
     disappearance reads the stale number — which is exactly how the mock version of this test once
     reported 5 against an oracle of 29. The only honest anchor is the new count itself. */
  await expect.poll(() => shownCount(page, { busyTimeout: 2000 }), { timeout: 15000 }).toBe(everything);
});
