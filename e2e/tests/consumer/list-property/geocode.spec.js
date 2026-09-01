import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* Reverse-geocode auto-fill, forward society search, and pin-first ordering on
   List Property → Location & pricing. The Google Places library + Geocoder are
   stubbed (after the SDK loads) so the tests are deterministic and don't depend
   on live geocoding responses. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543210';

// Replace the SDK's Places library (primary path) and Geocoder (fallback) with
// deterministic fakes. Must run AFTER the map's Google SDK has loaded (i.e. after
// `.gm-style` appears). `fail:true` makes every lookup come back empty.
async function stubGeo(page, { pincode = '411045', road = 'Baner Road', suburb = 'Baner', lat = 18.559, lng = 73.776, fail = false, types = ['sublocality_level_1', 'sublocality', 'political'], name = 'Test Place' } = {}) {
  await page.evaluate(({ pincode, road, suburb, lat, lng, fail, types, name }) => {
    const placeComps = [
      { types: ['postal_code'], longText: pincode },
      { types: ['route'], longText: road },
      { types: ['sublocality_level_1', 'sublocality', 'political'], longText: suburb },
    ];
    const placeObj = {
      addressComponents: placeComps,
      location: { lat: () => lat, lng: () => lng },
      displayName: name,
      formattedAddress: 'Test',
      types,
    };
    const FakePlace = {
      searchNearby: async () => ({ places: fail ? [] : [placeObj] }),
      searchByText: async () => ({ places: fail ? [] : [placeObj] }),
    };

    // Autocomplete (Places New) — a session token constructor plus a suggestion
    // fetcher that returns one prediction whose toPlace() resolves to `placeObj`.
    const makePrediction = (label) => ({
      placeId: 'test-place-id',
      text: { toString: () => label },
      mainText: { toString: () => label },
      secondaryText: { toString: () => 'Pune, Maharashtra' },
      toPlace: () => ({ ...placeObj, fetchFields: async () => ({}) }),
    });
    const FakeAutocompleteSuggestion = {
      fetchAutocompleteSuggestions: async ({ input }) => ({
        suggestions: fail ? [] : [{ placePrediction: makePrediction(input) }],
      }),
    };

    window.google = window.google || {};
    window.google.maps = window.google.maps || {};
    window.google.maps.places = window.google.maps.places || {};
    window.google.maps.places.AutocompleteSessionToken = class {};
    const realImport = window.google.maps.importLibrary
      ? window.google.maps.importLibrary.bind(window.google.maps)
      : null;
    window.google.maps.importLibrary = async (name) => {
      if (name === 'places') return { Place: FakePlace, AutocompleteSuggestion: FakeAutocompleteSuggestion, SearchNearbyRankPreference: { DISTANCE: 'DISTANCE' } };
      return realImport ? realImport(name) : {};
    };
    // Geocoder fallback — also stubbed so the fallback path stays deterministic.
    const gcComps = placeComps.map((c) => ({ types: c.types, long_name: c.longText }));
    window.google.maps.Geocoder = class {
      geocode(_req, cb) {
        const results = [{ address_components: gcComps, geometry: { location: { lat: () => lat, lng: () => lng } } }];
        if (typeof cb === 'function') {
          if (fail) cb(null, 'ZERO_RESULTS');
          else cb(results, 'OK');
          return undefined;
        }
        return fail ? Promise.reject(new Error('ZERO_RESULTS')) : Promise.resolve({ results });
      }
    };
  }, { pincode, road, suburb, lat, lng, fail, types, name });
}

async function gotoStep2(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(250);
  const opt = page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' });
  if (await opt.count()) await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });
}

async function searchArea(page, q) {
  await page.locator('input[placeholder*="Search a locality"]').fill(q);
  await page.getByRole('button', { name: /Search location/i }).click();
}

test('map (pin your location) appears before the address fields', async ({ page }) => {
  await gotoStep2(page);
  const map = page.locator('.gm-style').first();
  const localityLabel = page.getByText('Locality *', { exact: true });
  const mapY = (await map.boundingBox()).y;
  const locY = (await localityLabel.boundingBox()).y;
  expect(mapY).toBeLessThan(locY);
});

test('searching a known locality reverse-geocodes and fills empty address fields', async ({ page }) => {
  await gotoStep2(page);
  await stubGeo(page);
  // "Baner" is a known locality (offline gazetteer moves the pin); the reverse
  // geocode of that spot then fills the address via the stubbed Places lookup.
  await searchArea(page, 'Baner');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411045', { timeout: 8000 });
  await expect(page.locator('input[placeholder*="Baner-Balewadi Road"]')).toHaveValue('Baner Road');
  await expect(page.locator('[data-err="locality"]')).toContainText('Baner');
  await expect(page.getByText(/Filled some address fields from the map/i)).toBeVisible();
});

test('searching a named society (not a known locality) moves the pin via Places', async ({ page }) => {
  await gotoStep2(page);
  await stubGeo(page, { lat: 18.5938, lng: 73.7416 });
  // "Aspiria" isn't in the offline gazetteer — forward search must resolve it
  // through Google Places and drop the pin (no "couldn't find that area").
  await searchArea(page, 'Aspiria');
  await expect(page.getByText(/Location set:/i)).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/Couldn't find that area/i)).toHaveCount(0);
});

test('searching a named society auto-fills the society name from the pin', async ({ page }) => {
  await gotoStep2(page);
  // A place tagged as a premise/POI is a society/building — its name fills the
  // "Building / Society Name" field (alongside pincode/street/locality).
  await stubGeo(page, { lat: 18.5938, lng: 73.7416, name: 'Aspiria', types: ['premise', 'point_of_interest', 'establishment'] });
  await searchArea(page, 'Aspiria');
  await expect(page.locator('input[data-err="society"]')).toHaveValue('Aspiria', { timeout: 8000 });
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411045');
});

test('an off-list / differently-spelled locality snaps to the nearest known locality', async ({ page }) => {
  await gotoStep2(page);
  // Google returns an area name that ISN'T in our gazetteer ("Rajiv Gandhi Infotech
  // Park") but whose pin sits on canonical "Hinjawadi" — the coords fallback must
  // resolve it to "Hinjawadi" so the Locality field is never left with an unknown raw
  // name for an area we can actually name.
  await stubGeo(page, { lat: 18.591, lng: 73.738, suburb: 'Rajiv Gandhi Infotech Park', name: 'Aspiria', types: ['premise', 'point_of_interest'] });
  await searchArea(page, 'Aspiria');
  await expect(page.locator('[data-err="locality"]')).toContainText('Hinjawadi', { timeout: 8000 });
});

test('a corrective re-search replaces the previous auto-filled address', async ({ page }) => {
  await gotoStep2(page);
  // First pick a named society: fills society + pincode from its components.
  await stubGeo(page, { lat: 18.591, lng: 73.738, suburb: 'Hinjawadi', road: 'Nirmitee Road', pincode: '411057', name: 'Aspiria', types: ['premise', 'point_of_interest'] });
  await searchArea(page, 'Aspiria');
  await expect(page.locator('input[data-err="society"]')).toHaveValue('Aspiria', { timeout: 8000 });
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411057');

  // Now correct it to a different area (not a named society). The stale auto-filled
  // values must update to the new place — and the society (which the new area can't
  // supply) must clear, not linger.
  await stubGeo(page, { lat: 18.598, lng: 73.762, suburb: 'Wakad', road: 'Wakad Road', pincode: '411058', name: 'Shankar Kalat Nagar', types: ['sublocality', 'political'] });
  await searchArea(page, 'Shankar Kalat Nagar');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411058', { timeout: 8000 });
  await expect(page.locator('[data-err="locality"]')).toContainText('Wakad');
  await expect(page.locator('input[data-err="society"]')).toHaveValue('');
});

test('auto-fill never overwrites a value the owner already typed', async ({ page }) => {
  await gotoStep2(page);
  await stubGeo(page);
  await page.locator('input[data-err="pincode"]').fill('411099');
  await searchArea(page, 'Baner');
  await expect(page.locator('input[placeholder*="Baner-Balewadi Road"]')).toHaveValue('Baner Road', { timeout: 8000 });
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411099');
});

test('a search updates address fields restored from a saved draft (not just freshly auto-filled)', async ({ page }) => {
  // Reproduces the real-world bug: the owner returns to a draft whose address was filled
  // in a PRIOR session, so nothing is tracked in memory as "auto-filled". A new area
  // search MUST still refresh the stale values — restored draft fields aren't sacred
  // (only fields the owner edits in THIS session are). Old value-comparison ownership
  // saw the pre-filled fields as "not ours" and refused to touch them → the exact bug.
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
    localStorage.setItem('pnDraft:list-property', JSON.stringify({
      carpetArea: '1050', propertyType: 'flat',
      locality: 'Hinjawadi', society: 'Aspiria', pincode: '411057', street: 'Nirmitee Road',
    }));
  }, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
  // carpetArea + propertyType are restored from the draft — just advance to step 2.
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });
  // Sanity: the draft address really did restore into the fields.
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411057');
  await expect(page.locator('input[data-err="society"]')).toHaveValue('Aspiria');
  // Now search a different area (not a named society): every stale field must update,
  // and the society the new area can't supply must clear.
  await stubGeo(page, { lat: 18.598, lng: 73.762, suburb: 'Wakad', road: 'Wakad Road', pincode: '411058', name: 'Shankar Kalat Nagar', types: ['sublocality', 'political'] });
  await searchArea(page, 'Shankar Kalat Nagar');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411058', { timeout: 8000 });
  await expect(page.locator('[data-err="locality"]')).toContainText('Wakad');
  await expect(page.locator('input[data-err="society"]')).toHaveValue('');
});

test('a geocode failure leaves fields empty for manual entry (no crash)', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoStep2(page);
  await stubGeo(page, { fail: true });
  await searchArea(page, 'Baner');
  await page.waitForTimeout(1500);
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('');
  await expect(page.locator('input[placeholder*="Baner-Balewadi Road"]')).toHaveValue('');
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('typing shows live autocomplete suggestions and picking one pins + fills the address', async ({ page }) => {
  await gotoStep2(page);
  await stubGeo(page, { lat: 18.5938, lng: 73.7416 });
  await page.locator('input[placeholder*="Search a locality"]').fill('Aspiria');
  // Dropdown of predictions appears as you type (google.com/maps style).
  const option = page.locator('.pn-ac-item').first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await option.click();
  // Selecting resolves the place: pin set + address fields filled from its components.
  await expect(page.getByText(/Location set:/i)).toBeVisible({ timeout: 8000 });
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411045', { timeout: 8000 });
  await expect(page.locator('input[placeholder*="Baner-Balewadi Road"]')).toHaveValue('Baner Road');
});

