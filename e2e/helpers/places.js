import { expect } from '@playwright/test';

// Stubs the Places library after the Maps SDK loads so Google-only suggestions are deterministic; each label becomes a placeId
// `stubPlaceId(label, idPrefix)` (slugged to [A-Za-z0-9_-]{1,255}), which the backend's dev PlacesLookup trusts.
export const stubPlaceId = (label, idPrefix = 'stub-') => `${idPrefix}${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

export async function stubGooglePlaces(page, {
  lat = 18.5975, lng = 73.7701, locality = 'Wakad', pincode = '411057',
  types = ['premise'], idPrefix = 'stub-', empty = false,
} = {}) {
  await page.waitForFunction(() => !!window.google?.maps?.importLibrary, null, { timeout: 20000 });
  await page.evaluate(async (o) => {
    // The SDK replaces importLibrary once it finishes loading, which would undo the stub.
    await window.google.maps.importLibrary('places');
    // Mirrors stubPlaceId above; the page's CSP forbids rebuilding it from source with new Function.
    const idOf = (label) => `${o.idPrefix}${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const place = (label) => ({
      id: idOf(label),
      addressComponents: [
        { types: ['postal_code'], longText: o.pincode },
        { types: ['sublocality_level_1', 'sublocality', 'political'], longText: o.locality },
      ],
      location: { lat: () => o.lat, lng: () => o.lng },
      displayName: label,
      formattedAddress: `${label}, ${o.locality}, Pune`,
      types: o.types,
      fetchFields: async () => ({}),
    });
    const prediction = (label) => ({
      placeId: idOf(label),
      text: { toString: () => label },
      mainText: { toString: () => label },
      secondaryText: { toString: () => `${o.locality}, Pune, Maharashtra` },
      toPlace: () => place(label),
    });
    const realImport = window.google.maps.importLibrary.bind(window.google.maps);
    window.google.maps.importLibrary = async (name) => (name === 'places'
      ? {
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions: async ({ input }) => {
            (window.__placesQueries = window.__placesQueries || []).push(input);
            return { suggestions: o.empty ? [] : [{ placePrediction: prediction(input) }] };
          },
        },
      }
      : realImport(name));
  }, { lat, lng, locality, pincode, types, idPrefix, empty });
}

// A pin no other test uses, so the pick is never offered an "Is it one of these?" prompt.
export const isolatedPin = () => ({ lat: 18.42 + Math.random() * 0.2, lng: 73.72 + Math.random() * 0.25 });

const societyInput = (page) => page.getByTestId('society-input');

// Types `label`, picks the stubbed Google suggestion and waits for the picker to settle on it. A
// "Is it one of these?" prompt is answered "none of these" unless `candidate` asks to stop at it.
export async function pickGoogleSociety(page, label, { input = societyInput(page), candidate = false, keepsValue = true, keyboard = false, ...stub } = {}) {
  await stubGooglePlaces(page, stub);
  await input.click();
  await input.fill(label);
  const options = page.getByTestId('society-google-option');
  if (keyboard) {
    await options.filter({ hasText: label }).waitFor();
    await page.keyboard.press('Enter');
  } else {
    await options.filter({ hasText: label }).click();
  }
  await expect(options).toHaveCount(0);
  if (candidate) return;
  const notListed = page.getByTestId('society-not-listed-candidate');
  if (await notListed.count()) {
    await notListed.click();
    await expect(notListed).toHaveCount(0);
  }
  await expect(page.getByTestId('society-error')).toHaveCount(0);
  if (keepsValue) await expect(input).toHaveValue(label);
}

// The option is offered only once something has been typed.
export async function pickSocietyNotOnMaps(page, input = societyInput(page), typed = 'My building') {
  await input.click();
  await input.fill(typed);
  await page.getByTestId('society-not-on-maps').click();
  await expect(page.getByTestId('society-not-on-maps')).toHaveCount(0);
}

// The listing wizard's society field, whose input shares its data-err key with the wrapper.
export const wizardSocietyInput = (page) => page.locator('input[data-err="society"]');

export const fillSociety = (page, label, opts = {}) => pickGoogleSociety(page, label, { input: wizardSocietyInput(page), ...opts });
