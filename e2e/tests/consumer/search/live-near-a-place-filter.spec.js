import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';
import { API } from '../../../helpers/liveAuth.js';

/* "Near a Place" — the landmark picker, against the live catalogue.

   What this proves is a UI contract, not a data one: typing into the Near-a-Place field
   surfaces a Google Places prediction, picking it commits a *point* (lat/lng + label) to
   the filter state, and the distance controls + the removable chip appear as a result.
   Google is stubbed because a real Places call is a paid, rate-limited, non-deterministic
   dependency — the thing under test is what OUR code does with a prediction, not Google's.

   The live half is the page underneath. The mock twin ran the whole listings screen off
   `mockApi.js`; here the grid, the locality registry behind the dropdown and the count line
   are all served by the API, so this also proves the picker still works when its neighbours
   are doing real network I/O. It is a genuinely different failure surface: an unhandled
   rejection from a listings fetch lands in the same `trackErrors` bucket as a picker bug.

   The one piece of live grounding: the stubbed POI claims to be in Hinjawadi, and the nudge
   / snap logic downstream only works if `hinjawadi` is a locality the server actually knows.
   Asserted against `GET /localities` up front so a registry change fails here loudly rather
   than showing up later as a mute picker. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');

/* The parent locality the stubbed prediction claims. Read from the server, not asserted as
   a constant, so the failure message names the registry rather than the dropdown. */
const PARENT_SLUG = 'hinjawadi';

async function assertRegistryKnows(slug) {
  const res = await fetch(`${API}/localities`);
  expect(res.ok, `GET /localities -> ${res.status}`).toBe(true);
  const rows = await res.json();
  const list = Array.isArray(rows) ? rows : rows.content || [];
  expect(list.length, 'the locality registry is empty; the seed did not run').toBeGreaterThan(5);
  const hit = list.find((l) => (l.slug || '').toLowerCase() === slug);
  expect(hit, `"${slug}" is not in GET /localities, so nothing downstream can snap to it`).toBeTruthy();
  return hit;
}

// Stub Places (New) so a typed query resolves to a deterministic Pune POI prediction.
async function stubPlacesNear(page) {
  await page.evaluate(() => {
    const placeObj = {
      addressComponents: [{ types: ['sublocality_level_1', 'sublocality', 'political'], longText: 'Hinjawadi' }],
      location: { lat: () => 18.5913, lng: () => 73.7389 },
      displayName: 'Hinjawadi IT Park',
      formattedAddress: 'Hinjawadi IT Park, Pune',
    };
    const prediction = {
      placeId: 'near-place-id',
      text: { toString: () => 'Hinjawadi IT Park' },
      mainText: { toString: () => 'Hinjawadi IT Park' },
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

test('typing a landmark commits a point, not a string, and unfolds the distance controls', async ({ page }) => {
  await assertRegistryKnows(PARENT_SLUG);

  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings`);
  await filters(page).first().waitFor({ timeout: 15000 });
  /* The global APIProvider loads the real Maps SDK on every page; wait for it to settle
     (only the real payload sets `google.maps.version`) before overriding importLibrary,
     otherwise the late script load clobbers the stub. Fail-soft: if the SDK never loads
     there is nothing to clobber and the stub still wins. */
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  await stubPlacesNear(page);

  const group = filters(page).locator('.filter-group:has(h4:has-text("Near a Place"))').first();
  await group.locator('h4.fg-header').first().click();
  await group.locator('.pn-dropdown__trigger').first().click();

  const menu = page.locator('.pn-dropdown__menu--portal');
  await expect(menu).toBeVisible();
  // Empty state first: the field asks for input rather than pretending to have results.
  await expect(menu.locator('.pn-dropdown__empty')).toContainText(/Type to search/i);

  await menu.locator('input').fill('Hinj');
  const option = menu.locator('[role="option"]', { hasText: 'Hinjawadi IT Park' }).first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await option.click();

  // The menu closes and the trigger now reads back the place that was picked.
  await expect(menu).toHaveCount(0);
  await expect(group.locator('.pn-dropdown__trigger').first()).toContainText('Hinjawadi IT Park');

  /* A point, not a search term: the radius slider only renders when the filter is holding
     coordinates, and the active-filter chip is how the rest of the page learns about it. */
  await expect(group.locator('input[type="range"]')).toBeVisible();
  await expect(page.locator('.af-chip', { hasText: 'Hinjawadi IT Park' }).first()).toBeVisible();

  const relevant = errors.filter((e) => !/favicon|leaflet|CDN|net::ERR|Download the React DevTools/i.test(e));
  expect(relevant, relevant.join('\n')).toEqual([]);
});
