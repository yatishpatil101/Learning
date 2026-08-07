import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* "Near a Place" — auto-reveal distance controls.
   After a landmark is picked, the distance/commute panel unfolds below the
   select. The filter panel's OWN scroll container should scroll to reveal it,
   WITHOUT moving the window (guards the page-jump-to-footer regression). */

const BASE = 'http://localhost:5173';
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');

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

test('picking a place scrolls the filter panel (not the window) to reveal the distance controls', async ({ page }) => {
  const errors = trackErrors(page);

  // Short viewport so the sidebar's own scroll container must overflow.
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.goto(`${BASE}/listings`);
  await filters(page).first().waitFor();
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  await stubPlacesNear(page);

  const group = filters(page).locator('.filter-group:has(h4:has-text("Near a Place"))').first();
  await group.locator('h4.fg-header').first().click();
  await group.locator('.pn-dropdown__trigger').first().click();
  await expect(page.locator('.pn-dropdown__menu--portal')).toBeVisible();

  const scrollState = () => page.evaluate(() => {
    const s = document.querySelector('aside .filter-scroll');
    if (!s) return { panel: null, winY: window.scrollY };
    return { panel: Math.round(s.scrollTop), winY: window.scrollY };
  });
  const before = await scrollState();

  await page.locator('.pn-dropdown__menu--portal input').fill('Hinj');
  await page.locator('.pn-dropdown__menu--portal [role="option"]', { hasText: 'Hinjawadi IT Park' }).first().click();
  await expect(group.locator('input[type="range"]')).toBeVisible();
  await page.waitForTimeout(500); // allow the smooth in-container scroll to settle

  const after = await scrollState();

  // The filter panel scrolled down…
  expect(after.panel).toBeGreaterThan(before.panel);
  // …far enough to reveal the just-unfolded distance controls INSIDE the panel's own
  // scroll viewport (position-independent — "Near a Place" now sits mid-list).
  const revealed = await group.locator('input[type="range"]').evaluate((el) => {
    const s = document.querySelector('aside .filter-scroll').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
  });
  expect(revealed).toBe(true);
  // …and the WINDOW did not move (guards the page-jump-to-footer regression).
  expect(Math.abs(after.winY - before.winY)).toBeLessThanOrEqual(2);

  const relevant = errors.filter((e) => !/favicon|leaflet|CDN|net::ERR|Download the React DevTools/i.test(e));
  expect(relevant).toEqual([]);
});
