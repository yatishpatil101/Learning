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
  await page.locator('.pn-dropdown__search input').waitFor({ timeout: 5000 });
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
  await page.locator('.pn-dropdown__search input').fill('Datta');
  const option = page.locator('.pn-dropdown__option', { hasText: 'Datta Mandir Road' }).first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await option.click();

  // The pick is a street, but the filter chip must resolve to the PARENT locality.
  await expect(aside.locator('button[aria-label="Localities"] .pn-dropdown__value')).toHaveText(/Wakad/, { timeout: 8000 });
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
  await page.locator('.pn-dropdown__search input').fill('Wakad');
  const option = page.locator('.pn-dropdown__option', { hasText: 'Wakad' }).first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await option.click();

  await expect(aside.locator('button[aria-label="Localities"] .pn-dropdown__value')).toHaveText(/Wakad/, { timeout: 8000 });
  expect(errors, errors.join('\n')).toHaveLength(0);
});
