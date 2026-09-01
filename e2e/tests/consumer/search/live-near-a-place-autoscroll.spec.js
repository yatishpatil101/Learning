import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

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

test('picking a place scrolls the filter panel (not the window) to reveal the distance controls', async ({ page }) => {
  const errors = trackErrors(page);

  // Short viewport so the sidebar's own scroll container must overflow.
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.goto(`${BASE}/listings`);
  await filters(page).first().waitFor({ timeout: 15000 });
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  await stubPlacesNear(page);

  const group = filters(page).locator('.filter-group:has(h4:has-text("Near a Place"))').first();
  await group.locator('h4.fg-header').first().click();
  await group.locator('.pn-dropdown__trigger').first().click();
  await expect(page.locator('.pn-dropdown__menu--portal')).toBeVisible();

  const scrollState = () => page.evaluate(() => {
    const s = document.querySelector('aside .filter-scroll');
    const room = document.documentElement.scrollHeight - window.innerHeight;
    if (!s) return { panel: null, winY: window.scrollY, room };
    return { panel: Math.round(s.scrollTop), winY: window.scrollY, room };
  });

  await page.locator('.pn-dropdown__menu--portal input').fill('Hinj');
  const option = page.locator('.pn-dropdown__menu--portal [role="option"]', { hasText: 'Hinjawadi IT Park' }).first();
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
