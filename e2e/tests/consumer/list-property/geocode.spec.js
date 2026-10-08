import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew, API } from '../../../helpers/liveAuth.js';
import { pickFloors, LIST_PROPERTY_DRAFT_KEY } from '../../../helpers/listingForm.helper.js';
import { isolatedPin } from '../../../helpers/places.js';
// Stub Places and Geocoder after SDK load so geocode paths are deterministic.
async function stubGeo(page, { pincode = '411045', road = 'Baner Road', suburb = 'Baner', lat = 18.559, lng = 73.776, fail = false, types = ['sublocality_level_1', 'sublocality', 'political'], name = 'Test Place', localityName = '' } = {}) {
  await page.evaluate(({ pincode, road, suburb, lat, lng, fail, types, name, localityName }) => {
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

    const makePrediction = (label) => ({
      placeId: `test-place-id-${label}`.replace(/[^A-Za-z0-9_-]/g, '-'),
      text: { toString: () => label },
      mainText: { toString: () => label },
      secondaryText: { toString: () => 'Pune, Maharashtra' },
      toPlace: () => ({
        ...placeObj,
        ...(label === localityName ? { displayName: label, types: ['sublocality_level_1', 'sublocality', 'political'] } : {}),
        fetchFields: async () => ({}),
      }),
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
        window.__geocodeCalls = (window.__geocodeCalls || 0) + 1;
        const results = [{ address_components: gcComps, geometry: { location: { lat: () => lat, lng: () => lng } } }];
        if (typeof cb === 'function') {
          if (fail) cb(null, 'ZERO_RESULTS');
          else cb(results, 'OK');
          return undefined;
        }
        return fail ? Promise.reject(new Error('ZERO_RESULTS')) : Promise.resolve({ results });
      }
    };
  }, { pincode, road, suburb, lat, lng, fail, types, name, localityName });
}

async function stubGeolocation(page, { lat = 18.559, lng = 73.776 } = {}) {
  await page.addInitScript(({ lat, lng }) => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition(success) { success({ coords: { latitude: lat, longitude: lng } }); },
    } });
  }, { lat, lng });
}

const pickOption = async (page, dataErr, label) => {
  await page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`).click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
};

async function gotoStep2(page) {
  await signedInAsNew(page);
  await page.goto('/list-property');
  // Use .lp-steps: .lp-meter also appears on listing-limit paywall.
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  const opt = page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' });
  await expect(opt).toHaveCount(1);
  await opt.first().click();
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
}

async function fillLandDetails(page) {
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await pickOption(page, 'naStatus', 'Deemed NA');
  await pickOption(page, 'otherRights', 'Clear');
}

// Land keeps the area search bar above the map; flats search through the society field instead.
async function gotoLandStep2(page) {
  await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await page.locator('.radio-pill', { hasText: 'Sale' }).first().click();
  await pickOption(page, 'propertyType', 'Open Plot');
  await fillLandDetails(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
}

async function searchArea(page, q) {
  await page.locator('input[placeholder*="Search a locality"]').fill(q);
  await page.getByRole('button', { name: /Search location/i }).click();
}

async function pickGoogleSociety(page, name) {
  const society = page.locator('input[data-err="society"]');
  await society.click();
  await society.fill(name);
  await page.getByTestId('society-google-option').filter({ hasText: name }).click();
  return society;
}

test('a known locality reverse-geocodes into the address fields, and the map sits above them', async ({ page }) => {
  await gotoLandStep2(page);
  const mapY = (await page.locator('.gm-style').first().boundingBox()).y;
  const locY = (await page.getByText('Locality *', { exact: true }).boundingBox()).y;
  expect(mapY).toBeLessThan(locY);

  await stubGeo(page);
  // "Baner" is a known locality (offline gazetteer moves the pin); the reverse
  // geocode of that spot then fills the address via the stubbed Places lookup.
  await searchArea(page, 'Baner');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411045', { timeout: 8000 });
  await expect(page.locator('input[placeholder*="Baner-Balewadi Road"]')).toHaveValue('Baner Road');
  await expect(page.locator('[data-err="locality"]')).toContainText('Baner');
  await expect(page.getByText(/Filled some address fields from the map/i)).toBeVisible();
});

test('the current-location button pins the spot and reverse-geocodes its locality and pincode, with the map above the address fields', async ({ page }) => {
  await stubGeolocation(page);
  await gotoStep2(page);
  const mapY = (await page.locator('.gm-style').first().boundingBox()).y;
  const locY = (await page.getByText('Locality *', { exact: true }).boundingBox()).y;
  expect(mapY).toBeLessThan(locY);

  await stubGeo(page);
  await expect(page.getByText(/Location set:/i)).toHaveCount(0);
  await page.getByRole('button', { name: /Use my current location/i }).click();
  await expect(page.getByText(/Location set:/i)).toBeVisible({ timeout: 8000 });
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411045', { timeout: 8000 });
  await expect(page.locator('[data-err="locality"]')).toContainText('Baner');
});

test('searching a named building (not a known locality) pins it via Places but leaves the society to be picked from Google', async ({ page }) => {
  await gotoLandStep2(page);
  await stubGeo(page, { lat: 18.5938, lng: 73.7416, name: 'Aspiria', types: ['premise', 'point_of_interest', 'establishment'] });
  // "Aspiria" isn't in the offline gazetteer, so the forward search must resolve it
  // through Google Places and drop the pin.
  await searchArea(page, 'Aspiria');
  await expect(page.getByText(/Location set:/i)).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/Couldn't find that area/i)).toHaveCount(0);
  await expect(page.locator('input[data-err="society"]')).toHaveValue('');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411045');
});

test('a geocoded area that is not a saved locality is left for the owner to pick, and a corrective re-search binds one that is', async ({ page }) => {
  await gotoLandStep2(page);
  await stubGeo(page, { lat: 18.591, lng: 73.738, suburb: 'Rajiv Gandhi Infotech Park', road: 'Nirmitee Road', pincode: '411057', name: 'Aspiria', types: ['premise', 'point_of_interest'] });
  await searchArea(page, 'Aspiria');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411057', { timeout: 8000 });
  await expect(page.locator('[data-err="locality"]')).not.toContainText(/Hinjawadi|Rajiv/);
  await expect(page.locator('input[data-err="society"]')).toHaveValue('');

  await stubGeo(page, { lat: 18.598, lng: 73.762, suburb: 'Wakad', road: 'Wakad Road', pincode: '411058', name: 'Shankar Kalat Nagar', types: ['sublocality', 'political'] });
  await searchArea(page, 'Shankar Kalat Nagar');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411058', { timeout: 8000 });
  await expect(page.locator('[data-err="locality"]')).toContainText('Wakad');
  await expect(page.locator('input[data-err="society"]')).toHaveValue('');
});

test('auto-fill never overwrites a value the owner already typed', async ({ page }) => {
  await gotoLandStep2(page);
  await stubGeo(page);
  await page.locator('input[data-err="pincode"]').fill('411099');
  await searchArea(page, 'Baner');
  await expect(page.locator('input[placeholder*="Baner-Balewadi Road"]')).toHaveValue('Baner Road', { timeout: 8000 });
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411099');
});

test('a search updates address fields restored from a saved draft (not just freshly auto-filled)', async ({ page }) => {
  await signedInAsNew(page);
  await page.addInitScript((key) => {
    const user = JSON.parse(localStorage.getItem('draazyUser') || '{}');
    localStorage.setItem(key, JSON.stringify({
      deal: 'buy', carpetArea: '1050', propertyType: 'openplot',
      locality: 'Hinjawadi', society: 'Aspiria', pincode: '411057', street: 'Nirmitee Road',
      __owner: user.id || user.uuid || user.mobile || '',
    }));
  }, LIST_PROPERTY_DRAFT_KEY);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1050');
  await fillLandDetails(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411057');
  // Now search a different area: every stale address field must update.
  await stubGeo(page, { lat: 18.598, lng: 73.762, suburb: 'Wakad', road: 'Wakad Road', pincode: '411058', name: 'Shankar Kalat Nagar', types: ['sublocality', 'political'] });
  await searchArea(page, 'Shankar Kalat Nagar');
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411058', { timeout: 8000 });
  await expect(page.locator('[data-err="locality"]')).toContainText('Wakad');
});

test('typing shows live autocomplete suggestions and picking one pins + fills the address', async ({ page }) => {
  await gotoLandStep2(page);
  await stubGeo(page, { lat: 18.5938, lng: 73.7416 });
  await page.locator('input[placeholder*="Search a locality"]').fill('Aspiria');
  const option = page.locator('.dz-ac-item').first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await option.click();
  await expect(page.getByText(/Location set:/i)).toBeVisible({ timeout: 8000 });
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411045', { timeout: 8000 });
  await expect(page.locator('input[placeholder*="Baner-Balewadi Road"]')).toHaveValue('Baner Road');
});

test('society field offers Google Maps buildings our catalogue lacks, and picking one mints it', async ({ page, request }) => {
  await gotoStep2(page);
  const NAME = `Zz Gmaps Tower ${Date.now().toString(36)}`;
  await stubGeo(page, { lat: 18.5938, lng: 73.7416, name: NAME, types: ['premise', 'establishment'] });
  const society = page.locator('input[data-err="society"]');
  await society.click();
  await society.fill(NAME);
  const googleRow = page.getByTestId('society-google-option').filter({ hasText: NAME });
  await expect(googleRow).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('From Google Maps')).toBeVisible();
  await googleRow.click();

  await expect(society).toHaveValue(NAME);
  await expect(page.getByTestId('society-google-option')).toHaveCount(0);
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411045');

  const found = await request.get(`${API}/societies`, { params: { q: NAME, size: 20 } });
  expect(found.status()).toBe(200);
  const row = (await found.json()).content.find((s) => s.name === NAME);
  expect(row, 'the Google pick never reached the shared catalogue').toBeTruthy();
  expect(row.mintOrigin).toBe('listing');
  expect(Number(row.lat)).toBeCloseTo(18.5938, 3);
});

test('picking a Google Maps society fills the locality from its place', async ({ page }) => {
  await gotoStep2(page);
  const NAME = `Zz Gmaps Locality ${Date.now().toString(36)}`;
  await stubGeo(page, { lat: 18.591, lng: 73.738, suburb: 'Hinjawadi', pincode: '411057', name: NAME, types: ['premise', 'establishment'] });
  await pickGoogleSociety(page, NAME);

  await expect(page.locator('[data-err="locality"]')).toContainText('Hinjawadi', { timeout: 8000 });
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('411057');
});

test('a society picked in an area that is not yet a saved locality resolves that locality through Google and binds it', async ({ page, request }) => {
  await gotoStep2(page);
  const stamp = Date.now().toString(36);
  const LOCALITY = `Zz Loc ${stamp}`;
  const SOCIETY = `Zz Loc Tower ${stamp}`;
  const pin = isolatedPin();
  const before = await request.get(`${API}/localities/search`, { params: { q: LOCALITY } });
  expect(await before.json(), 'the locality must be new to the catalogue').toEqual([]);

  await stubGeo(page, { lat: pin.lat, lng: pin.lng, suburb: LOCALITY, pincode: '411057', name: SOCIETY, types: ['premise', 'establishment'], localityName: LOCALITY });
  await pickGoogleSociety(page, SOCIETY);

  await expect(page.locator('[data-err="locality"]')).toContainText(LOCALITY, { timeout: 10000 });
  const after = await request.get(`${API}/localities/search`, { params: { q: LOCALITY } });
  expect(after.status()).toBe(200);
  const row = (await after.json()).find((l) => l.name === LOCALITY);
  expect(row, 'the Google locality was never minted into the catalogue').toBeTruthy();
  expect(Number(row.lat)).toBeCloseTo(pin.lat, 3);
});

test('with no geocoder result, a typed society is not accepted, the pin stays unset, and a current-location lookup leaves the fields empty for manual entry', async ({ page, request, consoleErrors }) => {
  await stubGeolocation(page);
  await gotoStep2(page);
  await stubGeo(page, { fail: true });
  const NAME = `Zz Typed Society ${Date.now().toString(36)}`;
  const society = page.locator('input[data-err="society"]');
  await society.click();
  await society.fill(NAME);
  await expect(page.getByTestId('society-not-on-maps')).toBeVisible();
  await expect(page.getByTestId('society-google-option')).toHaveCount(0);
  await society.blur();
  await expect(society, 'typed text is never a society').toHaveValue('');

  await expect(page.getByText(/Location set:/i)).toHaveCount(0);
  await expect(page.locator('[data-err="locality"]')).not.toContainText('Baner');
  const found = await request.get(`${API}/societies`, { params: { q: NAME, size: 20 } });
  expect((await found.json()).content.find((s) => s.name === NAME), 'a typed name must not reach the catalogue').toBeUndefined();
  await page.getByRole('button', { name: /Use my current location/i }).click();
  // Prove geocoder was called; empty fields alone could mean the lookup never ran.
  await expect.poll(() => page.evaluate(() => window.__geocodeCalls || 0)).toBeGreaterThan(0);
  await expect(page.locator('input[data-err="pincode"]')).toHaveValue('');
  await expect(page.locator('[data-err="locality"]')).not.toContainText('Baner');
  expect(consoleErrors, consoleErrors.join('\n')).toHaveLength(0);
});