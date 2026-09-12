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
  // p5131 is the only commercially zoned plot in the seed, so it must be in the
  // unfiltered grid before the filter can be said to have kept it.
  expect(before).toContain('/property/p5131');

  /* "Commercial" is BOTH a property type and a land use in propertyTypes.js, so an
     unscoped getByRole('option', { name: 'Commercial' }) is genuinely ambiguous and
     would resolve against whichever dropdown React happened to mount first. Scope it
     to the Land-use listbox — and note that scoping by DOM ancestry does NOT work
     here: MultiSelect renders its menu through createPortal into document.body, so
     the options are not descendants of the filter panel they belong to. The portal
     carries `aria-label={ariaLabel}`, which is the only handle that survives. */
  await trigger(page, 'Land use').click();
  await page.getByRole('listbox', { name: 'Land use' })
    .getByRole('option', { name: 'Commercial', exact: true }).click();

  await expect(page.getByRole('button', { name: /Remove filter Commercial/i })).toBeVisible();

  /* The chip renders from `f` but the grid renders from `useDeferredValue(f)`
     (see Listings.jsx), so the chip can be on screen while the pre-filter list is
     still painted. A one-shot count() here reads whatever happens to be on screen
     at that instant and passes only by luck, which is why every assertion below
     re-reads the live DOM and lets the stale paint retry.

     This asserts the exact set because p5131 is the only approved commercially
     zoned plot. Note what it does NOT prove: fnvHash('p5131') % 4 also lands on
     'commercial', so this assertion held even while the browser was inventing the
     zone. That coincidence is exactly why the land_use defect survived - the
     obvious test for it passes either way. The test below is the one that can
     tell the two apart. */
  await expect.poll(async () => await cardHrefs(page), { timeout: 10000 })
    .toEqual(['/property/p5131']);
});

/* The regression test for the land_use defect proper.

   Zoning reaches the browser as `properties.land_use` (V95) -> PropertySummary ->
   propertyMapper -> landUseOf(). Every one of those links has been broken at some
   point: the column shipped with only the detail shape wired, so the card payload
   omitted it, so the mapper had nothing to read, so landUseOf() fell through to
   `LANDUSE_ZONES[hashId(p.id) % 4]` and the listings page filtered plots by a hash
   of the slug.

   p5124 is the discriminator. Postgres says 'residential'; the hash says 'mixed'.
   So under the correct implementation this filter returns exactly [p5124], and
   under any regression to hashing it returns [] - none of the three approved plots
   hashes to residential. A green here means the value was read, not guessed.

   Keep this pinned to p5124 specifically. Asserting "some plot is residential"
   would go green again the moment the hash happened to produce one. */
test('Land Use reflects the zoning the server stated, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=plot`);
  await cards(page).first().waitFor({ timeout: 10000 });
  expect(await cardHrefs(page)).toContain('/property/p5124');

  await trigger(page, 'Land use').click();
  await page.getByRole('listbox', { name: 'Land use' })
    .getByRole('option', { name: 'Residential', exact: true }).click();

  await expect.poll(async () => await cardHrefs(page), { timeout: 10000 })
    .toEqual(['/property/p5124']);
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
  await page.locator('.dz-dropdown__menu--portal input').fill('Hinj');
  await page.getByRole('option', { name: /Hinjawadi IT Park/ }).click();

  // The redesigned segmented control + slider + presets now appear.
  await expect(aside.getByRole('button', { name: /^Distance$/ })).toBeVisible();
  await expect(aside.getByRole('button', { name: /Commute time/ })).toBeVisible();
  await expect(aside.getByRole('slider', { name: 'Search radius' })).toBeVisible();

  // Switching to Commute time updates the preset chips (10 min preset exists).
  await aside.getByRole('button', { name: /Commute time/ }).click();
  await expect(aside.getByRole('button', { name: '10 min', exact: true })).toBeVisible();
});
