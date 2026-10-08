import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* "Near a Place" landmark picker against the live catalogue: picking a stubbed Google prediction commits a point (lat/lng + label) to the filter
   state and reveals the distance controls and chip. Google is stubbed because real Places calls are paid and non-deterministic. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
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

test('typing a landmark commits a point, not a string, and unfolds the distance controls', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings`);
  await filters(page).first().waitFor({ timeout: 15000 });
  /* Wait for the real Maps SDK to settle (only it sets `google.maps.version`) before overriding importLibrary, or
     the late script load clobbers the stub. */
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  await stubPlacesNear(page);

  const group = filters(page).locator('.filter-group:has(h4:has-text("Near a Place"))').first();
  // Collapsed until a place is set.
  await group.locator('.fg-header').first().click();
  const search = group.locator('input[type="search"]');
  // A plain field, not a dropdown: nothing is listed until something is typed.
  await expect(search).toBeVisible();
  await expect(group.getByRole('listbox')).toHaveCount(0);

  await search.fill('Hinj');
  const option = group.getByRole('option', { name: /Hinjawadi IT Park/ }).first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await expect(group.getByRole('img', { name: 'Powered by Google' }), 'Places predictions carry the Google attribution').toBeVisible();
  await option.click();

  await expect(group.getByRole('listbox')).toHaveCount(0);
  await expect(search).toHaveValue('Hinjawadi IT Park');

  /* A point, not a search term: the radius slider only renders when the filter is holding
     coordinates, and the active-filter chip is how the rest of the page learns about it. */
  await expect(group.locator('input[type="range"]')).toBeVisible();
  await expect(page.locator('.af-chip', { hasText: 'Hinjawadi IT Park' }).first()).toBeVisible();

  await expect(filters(page).getByRole('button', { name: /^Distance$/ })).toBeVisible();
  await expect(filters(page).getByRole('slider', { name: 'Search radius' })).toBeVisible();
  await filters(page).getByRole('button', { name: /Commute time/ }).click();
  await expect(filters(page).getByRole('button', { name: '10 min', exact: true })).toBeVisible();

  const relevant = errors.filter((e) => !/favicon|leaflet|CDN|net::ERR|Download the React DevTools/i.test(e));
  expect(relevant, relevant.join('\n')).toEqual([]);
});

/* Near a Place auto-reveal: the filter panel's own scroll container must reveal the distance controls without moving the window (page-jump regression).
   Also run live because the measurement races real network I/O; the baseline is read from the DOM just before the action, with no hard-coded pixels. */

test('picking a place scrolls the filter panel (not the window) to reveal the distance controls', async ({ page }) => {
  const errors = trackErrors(page);

  // Short viewport so the sidebar's own scroll container must overflow.
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.goto(`${BASE}/listings`);
  await filters(page).first().waitFor({ timeout: 15000 });
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  await stubPlacesNear(page);

  const group = filters(page).locator('.filter-group:has(h4:has-text("Near a Place"))').first();
  await group.locator('.fg-header').first().click();

  const scrollState = () => page.evaluate(() => {
    const s = document.querySelector('aside .filter-scroll');
    const room = document.documentElement.scrollHeight - window.innerHeight;
    if (!s) return { panel: null, winY: window.scrollY, room };
    return { panel: Math.round(s.scrollTop), winY: window.scrollY, room };
  });

  await group.locator('input[type="search"]').fill('Hinj');
  const option = group.getByRole('option', { name: /Hinjawadi IT Park/ }).first();
  /* Scroll the option into view before taking the baseline: if Playwright's click does it, the guard below blames the app
       for a jump the harness made. */
  await option.scrollIntoViewIfNeeded();
  const before = await scrollState();
  expect(before.panel, 'no `aside .filter-scroll` container, so nothing below measures the panel')
    .not.toBeNull();
  /* If the document fits the viewport, `window.scrollY` stays 0 and "did not jump" passes with the bug present, so
     first establish the window has room to jump. */
  expect(
    before.room,
    'the document fits inside the viewport, so the window cannot scroll and the page-jump guard '
    + 'below is true by construction rather than because the app behaved',
  ).toBeGreaterThan(4);

  await option.click();
  await expect(group.locator('input[type="range"]')).toBeVisible();
  /* `scrollState()` reads through `page.evaluate`, which does not retry, so poll for the panel to have moved instead of sleeping. */
  await expect.poll(async () => (await scrollState()).panel).toBeGreaterThan(before.panel);

  const after = await scrollState();

  // The filter panel scrolled down…
  expect(after.panel).toBeGreaterThan(before.panel);
  // …far enough to reveal the just-unfolded distance controls INSIDE the panel's own
  // scroll viewport (position-independent).
  const revealed = await group.locator('input[type="range"]').evaluate((el) => {
    const s = document.querySelector('aside .filter-scroll').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
  });
  expect(revealed).toBe(true);
  // …and the WINDOW did not move (guards the page-jump-to-footer regression).
  expect(Math.abs(after.winY - before.winY)).toBeLessThanOrEqual(2);

  const relevant = errors.filter((e) => !/favicon|leaflet|CDN|net::ERR|Download the React DevTools/i.test(e));
  expect(relevant, relevant.join('\n')).toEqual([]);
});

/* Near-a-Place radius edges: clearing the field must not store `''` (`nearParams` would drop the centre point and silently turn the filter off),
   and a shared `?nearr=9999` must not render a slider pinned beyond the 50 km server clamp. */

// Hinjawadi IT Park — a real point in the seeded catalogue's city, so the search is answerable.
const POINT = 'near=18.5913%2C73.7389&nearlabel=Hinjawadi+IT+Park';

const sidebar = (page) => page.locator('aside:has(h3:has-text("Filters"))').first();
/* Scoped to the group, not the page: the desktop aside and the mobile drawer both mount the whole
   panel, so every control inside it exists twice. */
const radiusField = (group) => group.getByLabel('Search radius value');

async function openNear(page, query) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings?${query}`);
  await sidebar(page).waitFor({ timeout: 15000 });
  const group = sidebar(page).locator('.filter-group:has(button.fg-header:has-text("Near a Place"))').first();
  /* The section ships collapsed, but that is a product call rather than a contract: read the
     state instead of assuming it, or the click that opens it today closes it tomorrow. */
  const header = group.locator('button.fg-header').first();
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  await expect(radiusField(group)).toBeVisible({ timeout: 10000 });
  return group;
}

test('clearing the radius repairs it instead of dropping the proximity filter', async ({ page }) => {
  const group = await openNear(page, `${POINT}&nearr=12`);
  await expect(radiusField(group)).toHaveValue('12');

  /* Over every later search: the bug was an absence on the wire, so one request carrying the point proves nothing
     about the one sent while the field was blank. */
  const unscoped = [];
  page.on('request', (r) => {
    if (!/\/properties\?/.test(r.url())) return;
    const p = new URL(r.url()).searchParams;
    if (!p.has('nearLat') || !p.has('nearLng') || !p.has('nearRadiusKm')) unscoped.push(r.url());
  });

  await radiusField(group).fill('');
  // Long enough for a search the blank would have triggered to reach the network.
  await page.waitForTimeout(1500);
  expect(unscoped, 'a search left without the proximity point while the radius field was blank').toEqual([]);

  // Typing resumes from empty without the field fighting back: 1, then 2, is twelve.
  await radiusField(group).pressSequentially('12');
  await expect(radiusField(group)).toHaveValue('12');
  await radiusField(group).blur();
  await expect(radiusField(group)).toHaveValue('12');
  await expect(page.locator('.af-chip', { hasText: 'Hinjawadi IT Park' }).first()).toBeVisible();
  expect(unscoped, 'a search left without the proximity point').toEqual([]);
});

test('a radius from outside the controls is clamped to the widest one offered', async ({ page }) => {
  const group = await openNear(page, `${POINT}&nearr=9999`);
  await expect(radiusField(group)).toHaveValue('25');
  await expect(group.locator('input[type="range"]')).toHaveAttribute('max', '25');
});
