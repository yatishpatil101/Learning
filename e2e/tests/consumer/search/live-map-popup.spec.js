import { test, expect } from '@playwright/test';
import { API } from '../../../helpers/liveAuth.js';

/* Listings "Map view" marker interaction. Clicking a price marker opens the slide-in Map Detail
   Panel (`.dz-mdp`) — a compact, richer clone of the property tile — and never a map InfoWindow.
   (The InfoWindow now only exists on the property-page mini-map, which passes no `onSelect`.)

   WHAT CHANGED IN THE MOVE TO LIVE. The mock ancestor fabricated a villa in `localStorage` so it
   could pin every number it asserted. Here the drawer renders a row the server returned, so the row
   is seeded instead — `p5150`, the Baner villa in `R__zz_DML_dev_demo_data.sql`, whose header comment
   explains which of its fields are load-bearing and why.

   THE CLICK TARGET IS A COMPUTED LABEL, NOT A SELECTOR. `PropertyMap.mapLabel` renders a buy marker
   as `₹(price / 1e7).toFixed(2)Cr`, so the fixture's ₹2,73,00,000 is the only pin reading `₹2.73Cr`.
   Markers overlap, and clicking `.first()` would let an adjacent pin intercept — so the label is
   both derived from the API price and asserted to be unique among the listings on the map, before
   it is used to click. A second Baner listing rounding to the same two decimals would otherwise turn
   this file into a coin flip that fails once a fortnight. */

const SLUG = 'p5150';

const get = async (query) => {
  const res = await fetch(`${API}/properties?${query}`);
  expect(res.ok, `GET /properties?${query} answered ${res.status}`).toBe(true);
  return res.json();
};

/** The exact string `PropertyMap.mapLabel` paints on a buy marker, for a given rupee price. */
const markerLabel = (price) => (price >= 1e7
  ? '₹' + (price / 1e7).toFixed(2) + 'Cr'
  : '₹' + Math.round(price / 1e5) + 'L');

/** The same figure as the drawer writes it — the marker's label with the unit spaced off. */
const drawerPrice = (price) => markerLabel(price).replace(/(Cr|L)$/, ' $1');

/** The fixture villa plus the map stock it has to be distinguishable from. */
async function banerStock() {
  const rows = (await get('deal=buy&localities=baner&size=100')).content;
  const villa = rows.find((p) => p.slug === SLUG);
  expect(villa, `the map fixture ${SLUG} is missing from the seed`).toBeTruthy();
  expect(villa.lat, `${SLUG} has no coordinates, so it paints no marker`).toBeTruthy();
  expect(villa.lng).toBeTruthy();

  // Positive anchor for the uniqueness claim below: Baner really does hold other buy listings, so
  // "no other marker shares this label" is a statement about a populated map.
  expect(rows.length, 'Baner holds only the fixture — marker ambiguity is untested').toBeGreaterThan(1);

  const label = markerLabel(villa.price);
  const clashes = rows.filter((p) => p.slug !== SLUG && markerLabel(p.price) === label);
  expect(clashes.map((p) => p.slug), `another Baner listing paints the same ${label} marker`).toEqual([]);

  return { villa, label, total: rows.length };
}

/** Open the map on Baner and click the fixture's marker. The map is area-first: it renders only
 *  once 1–5 localities are focused, so the locality is deep-linked to un-gate it. */
async function openDrawer(page, label) {
  await page.goto('/listings?deal=buy&view=map&loc=baner');
  const marker = page.locator('.price-marker', { hasText: label }).first();
  await marker.waitFor({ timeout: 20000 });
  await marker.click();
  const drawer = page.locator('.dz-mdp');
  await drawer.waitFor({ timeout: 10000 });
  return drawer;
}

test('clicking a map marker opens the detail drawer, not a map InfoWindow', async ({ page }) => {
  const { villa, label } = await banerStock();
  const drawer = await openDrawer(page, label);

  // The listings map opens the drawer. The InfoWindow is the thing that must not appear, and the
  // drawer above is the positive anchor that makes this absence mean "instead of" rather than
  // "nothing rendered at all".
  await expect(page.locator('.dz-gm-iw-prop')).toHaveCount(0);

  // Same building blocks as the standard tile, richer. The deal word is derived rather than
  // written as `/For Rent|For Sale/` — an alternation over the only two possible values asserts
  // the element is non-empty and nothing else, and would stay green on a drawer that called this
  // sale listing a rental.
  await expect(drawer.locator('.dz-mdp-deal')).toHaveText(villa.deal === 'buy' ? /For Sale/i : /For Rent/i);
  await expect(drawer.locator('.dz-mdp-price')).toContainText('₹');
  await expect(drawer.locator('.dz-mdp-loc')).toContainText('Pune');
  // "Open full page" links to a real property page.
  await expect(drawer.locator('.dz-mdp-full')).toHaveAttribute('href', /^\/property\//i);
});

test('the drawer reflects the property that was pinned, not the first one on the map', async ({ page }) => {
  const { villa, label } = await banerStock();
  const drawer = await openDrawer(page, label);

  // Identity first. Everything below is only evidence of "the right listing" if this holds.
  await expect(drawer.locator('.dz-mdp-full')).toHaveAttribute('href', `/property/${villa.slug}`);
  await expect(drawer.locator('.dz-mdp-title')).toHaveText(`${villa.bhk} BHK ${villa.propertyType}`);
  // Derived from the same figure the marker was found by, so a re-priced fixture moves the click
  // target and this assertion together instead of leaving a stale literal behind.
  await expect(drawer.locator('.dz-mdp-price')).toContainText(drawerPrice(villa.price));

  const facts = drawer.locator('.dz-mdp-fact');
  await expect(facts.filter({ hasText: `${villa.bhk} Bed` })).toHaveCount(1);
  await expect(facts.filter({ hasText: villa.area.toLocaleString('en-IN') + ' sq.ft' })).toHaveCount(1);
  await expect(facts.filter({ hasText: villa.propertyType })).toHaveCount(1);
});

test('the bathroom tile is missing because the search contract omits it, not because the drawer drops it', async () => {
  /* The mock ancestor asserted a "3 Bath" tile, because its fabricated row carried `bath: 3`. Live it
     cannot appear: the drawer is fed by the SEARCH response, and `PropertySummary` has no bathroom
     count, so `factsOf()` reads `Number(undefined) || 0` and skips the tile. `properties.bathrooms`
     IS set on the fixture (V114, and the seed sets it to 3), so the gap is a contract gap between
     the detail shape and the summary shape.

     Asserted here rather than as a bare `toHaveCount(0)` in the drawer, for two reasons. A count of
     zero in the panel is satisfied by a panel that never opened. And an absence blessed in the UI
     reads as "the drawer is right to hide it", which is the opposite of true — so this names the
     cause and goes red the day the summary grows the field, which is the day the tile should come
     back and the test above should assert it. */
  const summary = (await get(`deal=buy&localities=baner&size=100`)).content.find((p) => p.slug === SLUG);
  expect(summary, `the map fixture ${SLUG} is missing from the seed`).toBeTruthy();
  expect(Object.keys(summary)).not.toContain('bathrooms');

  // The number exists — it is only the summary that will not carry it. The status is checked so a
  // 404 fails as "the detail read did not answer" rather than as "the fixture lost its bathrooms".
  const res = await fetch(`${API}/properties/${SLUG}`);
  expect(res.ok, `GET /properties/${SLUG} answered ${res.status}`).toBe(true);
  const detail = await res.json();
  expect(detail.bathrooms, 'the fixture no longer states a bathroom count').toBe(3);
});
