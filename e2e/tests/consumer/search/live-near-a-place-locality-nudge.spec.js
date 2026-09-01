import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';
import { API } from '../../../helpers/liveAuth.js';

/* "Near a Place" cross-locality nudge, against the live catalogue.

   The bug this exists for: a user has localities selected (say Baner) and then picks a
   Near-a-Place point that actually sits in a DIFFERENT locality (a mall in Hinjawadi).
   The two location filters silently contradict, the grid empties, and nothing on screen
   explains why. The fix is a one-tap nudge offering to add the place's parent locality.

   Live matters here more than in most of this folder. The nudge's whole premise is that
   "Hinjawadi" — a string Google handed us inside an address component — resolves to a
   locality the *server* knows and can filter on. Against the mock provider that resolution
   was a lookup in a bundled JS array, so the spec could pass while the real registry had
   never heard of the place. `assertDistinctLocalities` below asks the API instead, and
   fails naming the registry rather than the dropdown.

   The second live-only assertion is the URL. The mock twin stopped at the dropdown's own
   label, which is client state reading back its own write — it would still pass if the add
   never reached the filter that drives the query. Asserting `?loc=` carries BOTH slugs
   proves the nudge changed the search, not just the chrome. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');

const SELECTED = 'baner';      // what the user picked first
const PLACE_PARENT = 'hinjawadi'; // where the stubbed POI actually sits

/* Both slugs must exist server-side AND be different rows, or the "conflicting locations"
   premise is fiction and the nudge would be correct to stay hidden. */
async function assertDistinctLocalities() {
  const res = await fetch(`${API}/localities`);
  expect(res.ok, `GET /localities -> ${res.status}`).toBe(true);
  const rows = await res.json();
  const list = Array.isArray(rows) ? rows : rows.content || [];
  expect(list.length, 'the locality registry is empty; the seed did not run').toBeGreaterThan(5);

  const slugs = list.map((l) => (l.slug || '').toLowerCase());
  expect(slugs, `"${SELECTED}" is not a server-known locality`).toContain(SELECTED);
  expect(slugs, `"${PLACE_PARENT}" is not a server-known locality, so nothing can snap to it`)
    .toContain(PLACE_PARENT);
  expect(SELECTED).not.toBe(PLACE_PARENT);
}

// Stub Places (New) so a typed query resolves to a POI in Hinjawadi (a locality the
// test has NOT selected) — its coords + sublocality snap to the "hinjawadi" registry.
async function stubPlacesNear(page) {
  await page.evaluate(() => {
    const placeObj = {
      addressComponents: [
        { types: ['sublocality_level_1', 'sublocality', 'political'], longText: 'Hinjawadi' },
      ],
      location: { lat: () => 18.5913, lng: () => 73.7389 },
      displayName: 'Xion Mall',
      formattedAddress: 'Xion Mall, Hinjawadi, Pune',
    };
    const prediction = {
      placeId: 'xion-mall-id',
      text: { toString: () => 'Xion Mall' },
      mainText: { toString: () => 'Xion Mall' },
      secondaryText: { toString: () => 'Hinjawadi, Pune' },
      toPlace: () => ({ ...placeObj, fetchFields: async () => ({}) }),
    };
    const FakeAutocompleteSuggestion = {
      fetchAutocompleteSuggestions: async () => ({ suggestions: [{ placePrediction: prediction }] }),
    };
    window.google = window.google || {};
    window.google.maps = window.google.maps || {};
    window.google.maps.places = window.google.maps.places || {};
    window.google.maps.places.AutocompleteSessionToken = class {};
    const realImport = window.google.maps.importLibrary
      ? window.google.maps.importLibrary.bind(window.google.maps)
      : null;
    window.google.maps.importLibrary = async (name) => {
      if (name === 'places') return { AutocompleteSuggestion: FakeAutocompleteSuggestion };
      return realImport ? realImport(name) : {};
    };
  });
}

/** The `loc` param, lower-cased and split, or [] when absent. */
const locParam = (page) => {
  const raw = new URL(page.url()).searchParams.get('loc') || '';
  return raw.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
};

test('picking a place in an unselected locality nudges the user to add it', async ({ page }) => {
  await assertDistinctLocalities();

  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings`);
  await page.locator('aside button[aria-label="Localities"]').waitFor({ timeout: 15000 });

  // Select "Baner" from the registry list (no stub yet, so live Places noise can't hijack
  // the pick — Baner is a curated locality present with or without Google).
  await page.locator('aside button[aria-label="Localities"]').click();
  await page.locator('.pn-dropdown__search input').waitFor({ timeout: 5000 });
  await page.locator('.pn-dropdown__search input').fill('Baner');
  await page.locator('.pn-dropdown__option', { hasText: /^Baner$/ }).first().click();
  await expect(page.locator('aside button[aria-label="Localities"] .pn-dropdown__value'))
    .toHaveText(/Baner/, { timeout: 8000 });

  // Now stub Places and pick a Hinjawadi POI in the Near-a-Place field.
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  await stubPlacesNear(page);

  const group = filters(page).locator('.filter-group:has(h4:has-text("Near a Place"))').first();
  await group.locator('h4.fg-header').first().click();
  await group.locator('.pn-dropdown__trigger').first().click();
  await page.locator('.pn-dropdown__menu--portal input').fill('Xion');
  await page.locator('.pn-dropdown__menu--portal [role="option"]', { hasText: 'Xion Mall' }).first().click();
  await expect(page.locator('.pn-dropdown__menu--portal')).toHaveCount(0);

  // The nudge appears: "<place> is in Hinjawadi …" with a one-tap add.
  const addBtn = group.locator('button', { hasText: 'Add Hinjawadi' });
  await expect(addBtn).toBeVisible({ timeout: 8000 });
  await expect(group.getByText(/is in Hinjawadi/i)).toBeVisible();

  // Accept it → Hinjawadi joins the localities, and the nudge self-hides.
  await addBtn.click();
  await expect(group.locator('button', { hasText: 'Add Hinjawadi' })).toHaveCount(0);
  await expect(page.locator('aside button[aria-label="Localities"] .pn-dropdown__value'))
    .toHaveText(/Hinjawadi/, { timeout: 8000 });

  /* …and the SEARCH changed, not just the label. Both slugs, because the nudge adds a
     locality rather than replacing the one the user chose. */
  await expect.poll(() => locParam(page), { timeout: 8000 }).toEqual(
    expect.arrayContaining([SELECTED, PLACE_PARENT]),
  );

  const relevant = errors.filter((e) => !/favicon|leaflet|CDN|net::ERR|Download the React DevTools/i.test(e));
  expect(relevant, relevant.join('\n')).toEqual([]);
});

/* Regression for the home-search / shared-URL path: the near point arrives via URL params
   (not an in-panel pick), so `onNearPick` never runs. The nudge must still fire because it
   is DERIVED from state — and the Near-a-Place group must start expanded so the nudge is
   actually visible. This is the exact "0 properties, no explanation" case from a home
   search like "Baner + Mastercard Hub (Hinjawadi)". */
test('nudge fires when the near point arrives from a URL (no in-panel pick)', async ({ page }) => {
  await assertDistinctLocalities();

  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  // loc=baner selects Baner; near coords sit in Hinjawadi (a locality NOT selected).
  await page.goto(`${BASE}/listings?loc=${SELECTED}&near=18.5913,73.7389&nearlabel=${encodeURIComponent('Xion Mall')}`);
  await page.locator('aside button[aria-label="Localities"]').waitFor({ timeout: 15000 });
  await expect(page.locator('aside button[aria-label="Localities"] .pn-dropdown__value'))
    .toHaveText(/Baner/, { timeout: 8000 });

  // The Near-a-Place group starts expanded (near preset) and the derived nudge shows.
  const group = filters(page).locator('.filter-group:has(h4:has-text("Near a Place"))').first();
  await expect(group.locator('button', { hasText: 'Add Hinjawadi' })).toBeVisible({ timeout: 8000 });
  await expect(group.getByText(/is in Hinjawadi/i)).toBeVisible();

  // One-tap add resolves the conflict, self-hides the nudge, and widens the query.
  await group.locator('button', { hasText: 'Add Hinjawadi' }).click();
  await expect(group.locator('button', { hasText: 'Add Hinjawadi' })).toHaveCount(0);
  await expect(page.locator('aside button[aria-label="Localities"] .pn-dropdown__value'))
    .toHaveText(/Hinjawadi/, { timeout: 8000 });
  await expect.poll(() => locParam(page), { timeout: 8000 }).toEqual(
    expect.arrayContaining([SELECTED, PLACE_PARENT]),
  );

  /* Same guard the in-panel test carries. This is the newer path of the two — the nudge is derived
     from state here rather than handed to it by `onNearPick` — so it is the likelier of the two to
     throw on the way to a screen that otherwise looks right. */
  const relevant = errors.filter((e) => !/favicon|leaflet|CDN|net::ERR|Download the React DevTools/i.test(e));
  expect(relevant, relevant.join('\n')).toEqual([]);
});
