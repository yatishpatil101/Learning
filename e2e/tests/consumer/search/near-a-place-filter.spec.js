import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* "Near a Place" listings filter.
   The dropdown is now LIVE-Google-only (no static seed list): you type and pick a
   real place suggestion. Regression guard for the bug where picking a place in the
   portaled, searchable dropdown scrolled the whole window to the page bottom (the menu
   is portaled to <body> end; a focus-scroll on the search input / option button was
   dragging the page down). The fix keeps focus from scrolling the page (input focus
   uses preventScroll; option buttons preventDefault on mousedown).

   Native focus-scroll can't be observed under Playwright's synthetic clicks, so this
   asserts the interaction still works end-to-end with zero console errors. */

const BASE = 'http://localhost:5173';
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');

// Stub Places (New) so a typed query resolves to a deterministic place prediction
// (a POI inside Pune) — mirrors the shared stub used by the locality-filter specs.
async function stubPlacesNear(page) {
  await page.evaluate(() => {
    const placeObj = {
      addressComponents: [
        { types: ['sublocality_level_1', 'sublocality', 'political'], longText: 'Hinjawadi' },
      ],
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

test('typing surfaces a live place, picking it applies the filter and closes the dropdown, no console errors', async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto(`${BASE}/listings`);
  await filters(page).first().waitFor();
  // Let the global APIProvider settle before overriding importLibrary (a late real
  // load would otherwise clobber the stub); fail-soft if the SDK never loads.
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  await stubPlacesNear(page);

  const group = filters(page).locator('.filter-group:has(h4:has-text("Near a Place"))').first();
  await group.locator('h4.fg-header').first().click();
  await group.locator('.pn-dropdown__trigger').first().click();
  await expect(page.locator('.pn-dropdown__menu--portal')).toBeVisible();

  // No static list: before typing the menu prompts for input, then a live result appears.
  await expect(page.locator('.pn-dropdown__menu--portal .pn-dropdown__empty')).toContainText(/Type to search/i);
  await page.locator('.pn-dropdown__menu--portal input').fill('Hinj');
  await page.locator('.pn-dropdown__menu--portal [role="option"]', { hasText: 'Hinjawadi IT Park' }).first().click();

  // Dropdown closes, value applies, distance panel reveals, chip appears.
  await expect(page.locator('.pn-dropdown__menu--portal')).toHaveCount(0);
  await expect(group.locator('.pn-dropdown__trigger')).toContainText('Hinjawadi IT Park');
  await expect(group.locator('input[type="range"]')).toBeVisible();
  await expect(page.locator('.af-chip', { hasText: 'Hinjawadi IT Park' }).first()).toBeVisible();

  const relevant = errors.filter((e) => !/favicon|leaflet|CDN|net::ERR|Download the React DevTools/i.test(e));
  expect(relevant).toEqual([]);
});
