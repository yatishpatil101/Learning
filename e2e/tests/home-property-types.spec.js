import { test, expect } from '@playwright/test';

/* "Explore by property type" tiles on the home page must route to the Listings
   page with the matching type applied as an ACTIVE filter (correct deal tab and
   a removable active-filter chip) — or, for Share Flat, to the dedicated
   Share-a-Flat finder. Property Type is now a dropdown, so the presentation-
   agnostic active-filter chip is the source of truth for what is selected. */

const BASE = 'http://localhost:5173';

// [tile title, expected deal, expected chip labels]
const TILES = [
  ['Flats', 'buy', ['Flat']],
  ['PG / Co-living', 'rent', ['PG / Hostel']],
  ['Commercial', 'buy', ['Commercial']],
  ['Plots / Land', 'buy', ['Open Plot']],
  ['Villas & Houses', 'buy', ['Independent House', 'Villa']],
];

for (const [title, deal, chips] of TILES) {
  test(`"${title}" tile routes to listings with its type filter active`, async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.getByRole('button', { name: title }).first().click();

    // Landed on listings on the correct deal tab.
    await expect(page).toHaveURL(/\/listings\?/);
    await expect(page).toHaveURL(new RegExp(`type=`));
    await expect(page.getByRole('heading', { name: new RegExp(`Properties for ${deal === 'rent' ? 'Rent' : 'Sale'} in Pune`) })).toBeVisible();

    // Each expected type shows as a removable active-filter chip.
    for (const label of chips) {
      await expect(page.getByRole('button', { name: new RegExp('Remove filter ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })).toBeVisible();
    }
  });
}

test('"Share Flat" tile routes to the Share-a-Flat finder', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'Share Flat' }).first().click();
  await expect(page).toHaveURL(/\/share-flat/);
});

test('"Flats" tile actually filters results to matching types', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'Flats' }).first().click();
  await expect(page.getByRole('button', { name: /Remove filter Flat/i })).toBeVisible();

  // Flats (Buy) has stock in the seed data → at least one property card renders.
  const cards = page.locator('a[href^="/property/"]');
  await cards.first().waitFor({ timeout: 10000 });
  expect(await cards.count()).toBeGreaterThan(0);
});
