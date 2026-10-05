import { test, expect } from '@playwright/test';
import { API } from '../../../helpers/liveAuth.js';

/* The map marker is clicked by its computed price label because markers overlap; uniqueness is
   asserted first so the live seeded row cannot be confused with neighbouring pins. */

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

test('clicking a map marker opens the detail drawer of the property that was pinned, not a map InfoWindow', async ({ page }) => {
  const { villa, label } = await banerStock();
  const drawer = await openDrawer(page, label);

  // The drawer above anchors this absence so it means "drawer instead of InfoWindow".
  await expect(page.locator('.dz-gm-iw-prop')).toHaveCount(0);

  // Derive the deal word from the fixture; `/For Rent|For Sale/` would only prove non-empty text.
  await expect(drawer.locator('.dz-mdp-deal')).toHaveText(villa.deal === 'buy' ? /For Sale/i : /For Rent/i);
  await expect(drawer.locator('.dz-mdp-price')).toContainText('₹');
  await expect(drawer.locator('.dz-mdp-loc')).toContainText('Pune');

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
  /* The search summary omits bathrooms while the detail shape has them; this names the contract gap
     so the tile comes back when summaries grow the field. */
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
