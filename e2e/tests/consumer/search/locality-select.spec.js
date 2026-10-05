import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';
import { signedInAs } from '../../../helpers/liveAuth.js';
import { pickFloors } from '../../../helpers/listingForm.helper.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543210';

async function stubPlacesOn(page, { lat = 18.538, lng = 73.807 } = {}) {
  await page.evaluate(({ lat, lng }) => {
    const placeObj = {
      addressComponents: [
        { types: ['postal_code'], longText: '411008' },
        { types: ['route'], longText: 'Pashan Road' },
        { types: ['sublocality_level_1', 'sublocality', 'political'], longText: 'Pashan' },
      ],
      location: { lat: () => lat, lng: () => lng },
      displayName: 'Pashan',
      formattedAddress: 'Pashan, Pune',
    };
    const makePrediction = (label) => ({
      placeId: 'loc-place-id',
      text: { toString: () => label },
      mainText: { toString: () => label },
      secondaryText: { toString: () => 'Pune, Maharashtra' },
      toPlace: () => ({ ...placeObj, fetchFields: async () => ({}) }),
    });
    const FakeAutocompleteSuggestion = {
      fetchAutocompleteSuggestions: async ({ input }) => ({
        suggestions: [{ placePrediction: makePrediction(input) }],
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
      if (name === 'places') return { AutocompleteSuggestion: FakeAutocompleteSuggestion };
      return realImport ? realImport(name) : {};
    };
  }, { lat, lng });
}
// Stub Places OFF — the autocomplete call throws, so live search yields nothing and
// the control must fall back to filtering the static locality list.
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

async function gotoStep2(page) {
  await signedInAs(page, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  const opt = page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' });
  await expect(opt).toHaveCount(1);
  await opt.first().click();
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });
}

async function openLocality(page) {
  await page.locator('[data-err="locality"] .dz-dropdown__trigger').click();
  await page.locator('.dz-dropdown__search input').waitFor({ timeout: 5000 });
}

test('typing a non-listed locality shows a live suggestion; picking it sets the value and recenters the map', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoStep2(page);
  await stubPlacesOn(page, { lat: 18.538, lng: 73.807 });

  await openLocality(page);
  // "Pashan" is NOT in the hardcoded shortlist — it must come from live Places.
  await page.locator('.dz-dropdown__search input').fill('Pashan');
  const option = page.locator('.dz-dropdown__option', { hasText: 'Pashan' }).first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await option.click();

  await expect(page.locator('[data-err="locality"] .dz-dropdown__value')).toHaveText(/Pashan/, { timeout: 5000 });
  await expect(page.getByText(/Location set:/i)).toBeVisible({ timeout: 8000 });
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('with Google unavailable the picker falls back to filtering the static list (no regression, no errors)', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoStep2(page);
  await stubPlacesOff(page);

  await openLocality(page);
  // Live search throws → we filter the offline shortlist; "Baner" is in that list.
  await page.locator('.dz-dropdown__search input').fill('Baner');
  const option = page.locator('.dz-dropdown__option', { hasText: 'Baner' }).first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await option.click();

  await expect(page.locator('[data-err="locality"] .dz-dropdown__value')).toHaveText(/Baner/, { timeout: 5000 });
  expect(errors, errors.join('\n')).toHaveLength(0);
});
