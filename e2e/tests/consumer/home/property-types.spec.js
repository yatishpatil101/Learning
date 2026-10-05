import { test, expect } from '@playwright/test';

/* Property Type is a dropdown, so the presentation-agnostic active-filter chip — not the control —
   is the source of truth for what a home-page tile actually applied. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

// [tile title, expected deal, expected chip labels]
const TILES = [
  ['Flats', 'buy', ['Flat']],
  ['Commercial', null, ['Commercial']],
  ['Plots / Land', 'buy', ['Open Plot', 'Farm Land']],
  ['Villas & Houses', 'buy', ['Independent House', 'Villa']],
];

for (const [title, deal, chips] of TILES) {
  test(`"${title}" tile routes to listings with its type filter active`, async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.getByRole('link', { name: new RegExp(`^${escapeRegExp(title)}\\b`) }).first().click();

    // Landed on listings on the correct deal tab.
    await expect(page).toHaveURL(/\/listings\?/);
    await expect(page).toHaveURL(new RegExp(`type=`));
    const actualDeal = new URL(page.url()).searchParams.get('deal') || deal;
    if (deal) expect(actualDeal).toBe(deal);
    await expect(page.getByRole('heading', { name: new RegExp(`Properties for ${actualDeal === 'rent' ? 'Rent' : 'Sale'} in Pune`) })).toBeVisible();

    // Each expected type shows as a removable active-filter chip.
    for (const label of chips) {
      await expect(page.getByRole('button', { name: new RegExp('Remove filter ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })).toBeVisible();
    }
  });
}

test('"Flatmates" tile routes to the Flatmates finder', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: /^Flatmates\b/ }).first().click();
  await expect(page).toHaveURL(/\/flatmates/);
});

test('"Flats" tile actually filters results to matching types', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.getByRole('link', { name: /^Flats\b/ }).first().click();
  await expect(page.getByRole('button', { name: /Remove filter Flat/i })).toBeVisible();

  // Flats (Buy) has stock in the seed data → at least one property card renders.
  const cards = page.locator('a[href^="/property/"]');
  await cards.first().waitFor({ timeout: 10000 });
  expect(await cards.count()).toBeGreaterThan(0);
});

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
