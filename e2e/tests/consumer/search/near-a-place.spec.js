import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';
import { API } from '../../../helpers/liveAuth.js';

/* "Near a Place" — the landmark picker, against the live catalogue.

   What this proves is a UI contract, not a data one: typing into the Near-a-Place field
   surfaces a Google Places prediction, picking it commits a *point* (lat/lng + label) to
   the filter state, and the distance controls + the removable chip appear as a result.
   Google is stubbed because a real Places call is a paid, rate-limited, non-deterministic
   dependency — the thing under test is what OUR code does with a prediction, not Google's.

   The live half is the page underneath. The mock twin ran the whole listings screen off
   `mockApi.js`; here the grid, the locality registry behind the dropdown and the count line
   are all served by the API, so this also proves the picker still works when its neighbours
   are doing real network I/O. It is a genuinely different failure surface: an unhandled
   rejection from a listings fetch lands in the same `trackErrors` bucket as a picker bug.

   The one piece of live grounding: the stubbed POI claims to be in Hinjawadi, and the nudge
   / snap logic downstream only works if `hinjawadi` is a locality the server actually knows.
   Asserted against `GET /localities` up front so a registry change fails here loudly rather
   than showing up later as a mute picker. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');

/* The parent locality the stubbed prediction claims. Read from the server, not asserted as
   a constant, so the failure message names the registry rather than the dropdown. */
const PARENT_SLUG = 'hinjawadi';

async function assertRegistryKnows(slug) {
  const res = await fetch(`${API}/localities`);
  expect(res.ok, `GET /localities -> ${res.status}`).toBe(true);
  const rows = await res.json();
  const list = Array.isArray(rows) ? rows : rows.content || [];
  expect(list.length, 'the locality registry is empty; the seed did not run').toBeGreaterThan(5);
  const hit = list.find((l) => (l.slug || '').toLowerCase() === slug);
  expect(hit, `"${slug}" is not in GET /localities, so nothing downstream can snap to it`).toBeTruthy();
  return hit;
}

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
  await assertRegistryKnows(PARENT_SLUG);

  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings`);
  await filters(page).first().waitFor({ timeout: 15000 });
  /* The global APIProvider loads the real Maps SDK on every page; wait for it to settle
     (only the real payload sets `google.maps.version`) before overriding importLibrary,
     otherwise the late script load clobbers the stub. Fail-soft: if the SDK never loads
     there is nothing to clobber and the stub still wins. */
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  await stubPlacesNear(page);

  const group = filters(page).locator('.filter-group:has(h4:has-text("Near a Place"))').first();
  await group.locator('.fg-header').first().click();
  await group.locator('.dz-dropdown__trigger').first().click();

  const menu = page.locator('.dz-dropdown__menu--portal');
  await expect(menu).toBeVisible();
  // Empty state first: the field asks for input rather than pretending to have results.
  await expect(menu.locator('.dz-dropdown__empty')).toContainText(/Type to search/i);

  await menu.locator('input').fill('Hinj');
  const option = menu.locator('[role="option"]', { hasText: 'Hinjawadi IT Park' }).first();
  await expect(option).toBeVisible({ timeout: 8000 });
  await option.click();

  // The menu closes and the trigger now reads back the place that was picked.
  await expect(menu).toHaveCount(0);
  await expect(group.locator('.dz-dropdown__trigger').first()).toContainText('Hinjawadi IT Park');

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

/* "Near a Place" — auto-reveal distance controls, against the live catalogue.

   After a landmark is picked the distance/commute panel unfolds below the select. The
   filter panel's OWN scroll container must scroll to reveal it WITHOUT moving the window
   — that is the page-jump-to-footer regression this guards.

   Why it is worth running live as well as mocked: the measurement is a race between the
   app's scroll and the page settling, and live the panel shares a frame with real network
   I/O (the grid re-fetching, the locality registry loading). A scroll-reveal that is only
   correct when everything else is instantaneous is not correct. Nothing here is a
   hard-coded pixel: the baseline is read from the DOM immediately before the action and
   every assertion is relative to it. */

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
  await group.locator('.dz-dropdown__trigger').first().click();
  await expect(page.locator('.dz-dropdown__menu--portal')).toBeVisible();

  const scrollState = () => page.evaluate(() => {
    const s = document.querySelector('aside .filter-scroll');
    const room = document.documentElement.scrollHeight - window.innerHeight;
    if (!s) return { panel: null, winY: window.scrollY, room };
    return { panel: Math.round(s.scrollTop), winY: window.scrollY, room };
  });

  await page.locator('.dz-dropdown__menu--portal input').fill('Hinj');
  const option = page.locator('.dz-dropdown__menu--portal [role="option"]', { hasText: 'Hinjawadi IT Park' }).first();
  /* Bring the option into view BEFORE the baseline, then take it, then click.
     `click()` scrolls its target into view first, and the menu is a portal anchored below a
     trigger that can sit near the bottom of a 620px viewport — so on the runs where the option
     lands below the fold, Playwright scrolls the *window* itself and the guard below then blames
     the app for a jump the harness performed. Doing the scroll explicitly first makes the baseline
     measure only what the app does in response to the pick, which is the thing under test. */
  await option.scrollIntoViewIfNeeded();
  const before = await scrollState();
  expect(before.panel, 'no `aside .filter-scroll` container, so nothing below measures the panel')
    .not.toBeNull();
  /* The window-did-not-move guard at the end of this test is the file's headline claim, and it is
     the one assertion that can be true for the wrong reason: if the document ever fits inside the
     viewport, `window.scrollY` is pinned at 0 and "the page did not jump" holds with the bug fully
     present. So establish first that the window has somewhere to jump TO. `/listings` is a
     sticky-sidebar layout, so a future shell that scrolls only internally would silently retire
     this test rather than fail it. */
  expect(
    before.room,
    'the document fits inside the viewport, so the window cannot scroll and the page-jump guard '
    + 'below is true by construction rather than because the app behaved',
  ).toBeGreaterThan(4);

  await option.click();
  await expect(group.locator('input[type="range"]')).toBeVisible();
  /* `scrollState()` reads through `page.evaluate`, which does not retry, so a fixed sleep here
     would be load-bearing. Polling for the panel to have moved waits for the smooth scroll to
     finish rather than for a duration somebody watched it take once. */
  await expect.poll(async () => (await scrollState()).panel).toBeGreaterThan(before.panel);

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
  expect(relevant, relevant.join('\n')).toEqual([]);
});

/* The Near-a-Place radius, at its two edges.

   Clearing the number field must not store `''`: `nearParams` treats a non-numeric radius as no
   radius and returns `{}` — which drops the CENTRE POINT with it, so the whole proximity filter
   went silently off while the chip and the place name stayed on screen. The buyer is looking at a
   search that says "within N km of Hinjawadi" and reading results from all of Pune.

   The repair keeps the half-typed text out of the filter rather than writing a repaired value into
   it: a blank field is a keystroke on the way somewhere, so the radius already in effect stands
   until a legal one replaces it. Pinned as "no request ever left without the point", because the
   bug produced a perfectly healthy-looking screen — nothing in the DOM distinguishes it.

   The other edge is the ceiling. The controls offer 25 km and the server clamps at 50, so a
   hand-edited or shared `?nearr=9999` would otherwise render a slider pinned at a number the
   search never honoured. What is displayed must be what was asked. */

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

  /* Every search the page runs from here on. The bug was an ABSENCE on the wire, so the assertion
     has to be over all of them — a single later request carrying the point proves nothing about
     the one that went out while the field was blank. */
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
