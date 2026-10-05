import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* Listings → Localities filter (locality-only model).
   Verifies: (1) typing a STREET / sub-area (e.g. "Datta Mandir Road") surfaces a
   live Google suggestion and picking it snaps UP to its PARENT canonical locality
   (Wakad) — never a dead street slug; (2) with Google unavailable the filter falls
   back to the static canonical registry list (no regression, no console errors). */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

// Stub Places (New) so a typed query resolves to a deterministic street prediction
// whose place carries a parent-locality label ("Wakad") + coords inside Wakad.
async function stubPlacesStreet(page) {
  await page.evaluate(() => {
    const placeObj = {
      addressComponents: [
        { types: ['postal_code'], longText: '411057' },
        { types: ['route'], longText: 'Datta Mandir Road' },
        { types: ['sublocality_level_1', 'sublocality', 'political'], longText: 'Wakad' },
      ],
      location: { lat: () => 18.5975, lng: () => 73.7898 },
      displayName: 'Datta Mandir Road',
      formattedAddress: 'Datta Mandir Road, Wakad, Pune',
    };
    const prediction = {
      placeId: 'street-place-id',
      text: { toString: () => 'Datta Mandir Road' },
      mainText: { toString: () => 'Datta Mandir Road' },
      secondaryText: { toString: () => 'Wakad, Pune, Maharashtra' },
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

// Stub Places OFF — the autocomplete call throws, so live search yields nothing and
// the filter must fall back to filtering the static canonical registry list.
async function stubPlacesOff(page) {
  await page.evaluate(() => {
    window.google = window.google || {};
    window.google.maps = window.google.maps || {};
    window.google.maps.places = window.google.maps.places || {};
    window.google.maps.places.AutocompleteSessionToken = class {};
    const realImport = window.google.maps.importLibrary
      ? window.google.maps.importLibrary.bind(window.google.maps)
      : null;
    window.google.maps.importLibrary = async (name) => {
      if (name === 'places') {
        return { AutocompleteSuggestion: { fetchAutocompleteSuggestions: async () => { throw new Error('places off'); } } };
      }
      return realImport ? realImport(name) : {};
    };
  });
}

async function openLocalityFilter(page) {
  const aside = page.locator('aside');
  await aside.locator('button[aria-label="Localities"]').click();
  await page.locator('.dz-dropdown__search input').waitFor({ timeout: 5000 });
  return aside;
}

test('picking a street snaps the filter UP to its parent canonical locality (Wakad)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings`);
  await page.locator('aside button[aria-label="Localities"]').waitFor({ timeout: 15000 });
  // The global APIProvider loads the real Maps SDK on every page; wait until it has
  // fully settled (only the real payload sets google.maps.version) before overriding
  // importLibrary, otherwise the late script load clobbers our stub. Fail-soft: if the
  // SDK never loads (offline), there's nothing to clobber, so the stub still wins.
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  await stubPlacesStreet(page);

  const aside = await openLocalityFilter(page);
  await page.locator('.dz-dropdown__search input').fill('Datta');
  const option = page.locator('.dz-dropdown__option', { hasText: 'Datta Mandir Road' }).first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await option.click();

  // The pick is a street, but the filter chip must resolve to the PARENT locality.
  await expect(aside.locator('button[aria-label="Localities"] .dz-dropdown__value')).toHaveText(/Wakad/, { timeout: 8000 });
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('with Google unavailable the filter falls back to the static canonical registry (no errors)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings`);
  await page.locator('aside button[aria-label="Localities"]').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  await stubPlacesOff(page);

  const aside = await openLocalityFilter(page);
  // Live search throws → filter the offline registry; "Wakad" is a curated locality.
  await page.locator('.dz-dropdown__search input').fill('Wakad');
  const option = page.locator('.dz-dropdown__option', { hasText: 'Wakad' }).first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await option.click();

  await expect(aside.locator('button[aria-label="Localities"] .dz-dropdown__value')).toHaveText(/Wakad/, { timeout: 8000 });
  expect(errors, errors.join('\n')).toHaveLength(0);
});

/* Regression guard: the filter's Localities search once knew only the listing-derived seed
   localities, so any other Pune locality returned "No matches". The canonical registry is merged in,
   searchable offline with no Maps SDK. */
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');

test('registry-only localities are searchable and selectable in the filter', async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto(`${BASE}/listings`);
  await filters(page).first().waitFor();

  const group = filters(page).locator('.filter-group:has(h4:has-text("Localities"))').first();
  await group.locator('.dz-dropdown__trigger').first().click();
  await expect(page.locator('.dz-dropdown__menu--portal')).toBeVisible();

  // "Kalyani Nagar" is in the canonical registry but NOT in the seed collection.
  await page.locator('.dz-dropdown__menu--portal input').first().fill('Kalyani');
  const option = page.locator('.dz-dropdown__menu--portal [role="option"]', { hasText: 'Kalyani Nagar' }).first();
  await expect(option).toBeVisible();
  await option.click();

  // Selection applies; the chip shows the friendly name (not a raw slug).
  await expect(group.locator('.dz-dropdown__trigger')).toContainText('Kalyani Nagar');
  await expect(page.locator('.af-chip', { hasText: 'Kalyani Nagar' }).first()).toBeVisible();

  const relevant = errors.filter((e) => !/favicon|leaflet|CDN|net::ERR|Download the React DevTools/i.test(e));
  expect(relevant).toEqual([]);
});
