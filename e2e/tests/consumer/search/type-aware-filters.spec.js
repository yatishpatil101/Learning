import { test, expect } from '@playwright/test';

/* Property-type-aware Listings filters:
   - the sidebar shows only the filter groups relevant to the selected Property Type
   - land types (Open Plot / Farm Land) reveal a "Land Use" (zone) filter and hide
     residential-only groups (BHK, Furnishing, Construction Status)
   - commercial hides BHK but keeps built-property filters (Furnishing) and never
     shows Land Use
   - the Land Use filter actually narrows results and renders a removable chip
   - filter dropdowns auto-close after a value is picked

   All dropdown/group assertions are scoped to the DESKTOP sidebar (the mobile
   drawer is mounted off-screen and appears first in the DOM). */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const trigger = (page, name) => filters(page).getByRole('button', { name, exact: true });
const groupHeading = (page, name) => filters(page).locator('h4.fg-header').filter({ hasText: name });
const cards = (page) => page.locator('a[href^="/property/"]');

// Stub Places (New) so a typed Near-a-Place query resolves to a deterministic Pune POI.
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

test('Land property type reveals Land Use and hides residential-only filters', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=plot`);
  await expect(trigger(page, 'Property type')).toBeVisible();

  // Land-specific zone filter appears...
  await expect(trigger(page, 'Land use')).toBeVisible();
  // ...and residential-only groups are gone.
  await expect(groupHeading(page, 'BHK Type')).toHaveCount(0);
  await expect(groupHeading(page, 'Furnishing')).toHaveCount(0);
  await expect(groupHeading(page, 'Construction Status')).toHaveCount(0);
});

test('Commercial hides BHK, keeps Furnishing, and never shows Land Use', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=commercial`);
  await expect(trigger(page, 'Commercial type')).toBeVisible();

  await expect(groupHeading(page, 'BHK Type')).toHaveCount(0);
  await expect(groupHeading(page, 'Furnishing')).toBeVisible();
  await expect(trigger(page, 'Land use')).toHaveCount(0);
});

test('Residential type keeps BHK and shows no Land Use filter', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=flat`);
  await expect(groupHeading(page, 'BHK Type')).toBeVisible();
  await expect(trigger(page, 'Land use')).toHaveCount(0);
});

/* Identity of every rendered card, in DOM order. Used instead of a bare count()
   so the filtered grid can be checked as a whole set (subset of the unfiltered
   grid), not just as a smaller number. */
const cardHrefs = (page) => cards(page).evaluateAll((els) => els.map((el) => el.getAttribute('href')));

test('Land Use filter narrows results and renders a removable chip', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=plot`);
  await cards(page).first().waitFor({ timeout: 10000 });
  const before = await cardHrefs(page);
  expect(before.length).toBeGreaterThan(1);

  // Pick the "Commercial" zone (seed data guarantees exactly one commercial-zone plot).
  await trigger(page, 'Land use').click();
  await page.getByRole('option', { name: 'Commercial', exact: true }).click();

  await expect(page.getByRole('button', { name: /Remove filter Commercial/i })).toBeVisible();

  /* The chip renders from `f` but the grid renders from `useDeferredValue(f)`
     (see Listings.jsx), so the chip can be on screen while the pre-filter list is
     still painted. A one-shot `count()` here reads whatever happens to be on
     screen at that instant and passes only by luck.

     `commercial-type-filter.spec.js` solves this with a whole-set assertion on
     renderable text (`cards.filter({ hasNotText: label })` -> 0). That is not
     available for Land Use: the zone is derived, not printed. `landUseOf()` in
     listings/matchers.js falls back to `LANDUSE_ZONES[hashId(p.id) % 4]` and
     Card.jsx never renders the zone anywhere on the card, so no text predicate
     can identify a commercial-zone plot. The whole-set property that *is*
     expressible is set containment: the filtered grid must be a strict subset of
     the unfiltered grid. Every assertion below re-reads the live DOM, so the
     stale paint retries instead of passing or failing on a snapshot. */
  await expect.poll(async () => (await cardHrefs(page)).length, { timeout: 10000 })
    .toBeLessThan(before.length);

  const after = await cardHrefs(page);
  expect(after.length).toBeGreaterThan(0);
  // Strict subset: filtering may only remove cards, never introduce new ones.
  expect(after.filter((href) => !before.includes(href))).toEqual([]);
});

test('Filter dropdown auto-closes after a value is selected', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=buy`);
  await trigger(page, 'Property type').click();
  await expect(page.getByRole('listbox', { name: 'Property type' })).toBeVisible();

  await page.getByRole('option', { name: 'Villa', exact: true }).click();
  // autoClose: the menu unmounts immediately after the pick.
  await expect(page.getByRole('listbox', { name: 'Property type' })).toHaveCount(0);
  // ...and the selection registered as an active chip.
  await expect(page.getByRole('button', { name: /Remove filter Villa/i })).toBeVisible();
});

test('Near a Place: selecting a place reveals the Distance / Commute control', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=buy`);
  const aside = filters(page);
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  await stubPlacesNear(page);

  // Expand the (default-collapsed) "Near a Place" group.
  await aside.locator('h4.fg-header').filter({ hasText: 'Near a Place' }).click();

  // Type to get a live Google suggestion (no static seed list) and pick it.
  await aside.getByRole('button', { name: 'Search a place near your locality' }).click();
  await page.locator('.pn-dropdown__menu--portal input').fill('Hinj');
  await page.getByRole('option', { name: /Hinjawadi IT Park/ }).click();

  // The redesigned segmented control + slider + presets now appear.
  await expect(aside.getByRole('button', { name: /^Distance$/ })).toBeVisible();
  await expect(aside.getByRole('button', { name: /Commute time/ })).toBeVisible();
  await expect(aside.getByRole('slider', { name: 'Search radius' })).toBeVisible();

  // Switching to Commute time updates the preset chips (10 min preset exists).
  await aside.getByRole('button', { name: /Commute time/ }).click();
  await expect(aside.getByRole('button', { name: '10 min', exact: true })).toBeVisible();
});
