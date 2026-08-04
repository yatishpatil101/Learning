import { test, expect } from '@playwright/test';

/* "Near a Place" cross-locality nudge.
   When a user has localities selected (e.g. Baner) and then picks a Near-a-Place
   point that actually sits in a DIFFERENT locality (a mall in Hinjawadi), the two
   location filters silently contradict and return 0 results. Instead of a blank
   screen we surface a one-tap nudge to add the place's parent locality. This spec
   selects Baner, picks a Hinjawadi POI, asserts the nudge, and adds Hinjawadi. */

const BASE = 'http://localhost:5173';
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');

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

test('picking a place in an unselected locality nudges the user to add it', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings`);
  await page.locator('aside button[aria-label="Localities"]').waitFor({ timeout: 15000 });

  // Select "Baner" from the static registry list (no stub yet, so live search noise
  // can't hijack the pick — Baner is a curated locality always present offline).
  await page.locator('aside button[aria-label="Localities"]').click();
  await page.locator('.pn-dropdown__search input').waitFor({ timeout: 5000 });
  await page.locator('.pn-dropdown__search input').fill('Baner');
  await page.locator('.pn-dropdown__option', { hasText: 'Baner' }).first().click();
  await expect(page.locator('aside button[aria-label="Localities"] .pn-dropdown__value')).toHaveText(/Baner/, { timeout: 8000 });

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
  await expect(page.locator('aside button[aria-label="Localities"] .pn-dropdown__value')).toHaveText(/Hinjawadi/, { timeout: 8000 });

  const relevant = errors.filter((e) => !/favicon|leaflet|CDN|net::ERR|Download the React DevTools/i.test(e));
  expect(relevant).toEqual([]);
});

/* Regression for the home-search / shared-URL path: the near point arrives via URL
   params (not an in-panel pick), so onNearPick never runs. The nudge must still fire
   because it is DERIVED from state — and the Near-a-Place group must start expanded so
   the nudge is actually visible. This is the exact "0 properties, no explanation" case
   from a home search like "Baner + Mastercard Hub (Hinjawadi)". */
test('nudge fires when the near point arrives from a URL (no in-panel pick)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  // loc=baner selects Baner; near coords sit in Hinjawadi (a locality NOT selected).
  await page.goto(`${BASE}/listings?loc=baner&near=18.5913,73.7389&nearlabel=${encodeURIComponent('Xion Mall')}`);
  await page.locator('aside button[aria-label="Localities"]').waitFor({ timeout: 15000 });
  await expect(page.locator('aside button[aria-label="Localities"] .pn-dropdown__value')).toHaveText(/Baner/, { timeout: 8000 });

  // The Near-a-Place group starts expanded (near preset) and the derived nudge shows.
  const group = filters(page).locator('.filter-group:has(h4:has-text("Near a Place"))').first();
  await expect(group.locator('button', { hasText: 'Add Hinjawadi' })).toBeVisible({ timeout: 8000 });
  await expect(group.getByText(/is in Hinjawadi/i)).toBeVisible();

  // One-tap add resolves the conflict and self-hides the nudge.
  await group.locator('button', { hasText: 'Add Hinjawadi' }).click();
  await expect(group.locator('button', { hasText: 'Add Hinjawadi' })).toHaveCount(0);
  await expect(page.locator('aside button[aria-label="Localities"] .pn-dropdown__value')).toHaveText(/Hinjawadi/, { timeout: 8000 });
});
