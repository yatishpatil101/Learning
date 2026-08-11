import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* Location trust & recovery — two additions that keep a location search from
   ever dead-ending or hiding stock quality:
   (1) Home suggestions carry a LIVE listing-count badge, so a seeker can see a
       stocked area ("5 listings") vs. an empty one ("No listings") before picking.
   (2) Listings auto-relaxes an impossible locality ∩ near-a-place combination
       (e.g. a shared link scoping to a slug that has no stock but sits beside
       areas that do) to the proximity intent, and surfaces a dismissible banner.
   All with zero page errors. */

const BASE = 'http://localhost:5173';
const HERO = '.hero-search-wrap';
const INPUT = 'input[aria-label="Search localities, societies or landmarks"]';

async function gotoHome(page) {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/`);
  await page.locator(HERO).waitFor({ timeout: 15000 });
  return errors;
}

test('home suggestions show a live listing-count badge (stocked vs empty)', async ({ page }) => {
  const errors = await gotoHome(page);
  const input = page.locator(`${HERO} ${INPUT}`);

  // A stocked locality shows a positive count ("N listings").
  await input.fill('Baner');
  const baner = page.locator(`${HERO} .loc-sugg`, { hasText: 'Baner' }).first();
  await expect(baner).toBeVisible({ timeout: 6000 });
  const banerCount = baner.locator('.loc-sugg-count');
  await expect(banerCount).toBeVisible();
  await expect(banerCount).toHaveText(/\d+\s+listing/);
  await expect(baner).not.toHaveClass(/loc-sugg--empty/);

  // A registry locality with zero stock is still offered (discovery) but is
  // clearly marked "No listings" and flagged with the empty modifier class.
  await input.fill('NIBM');
  const nibm = page.locator(`${HERO} .loc-sugg`, { hasText: 'NIBM' }).first();
  await expect(nibm).toBeVisible({ timeout: 6000 });
  await expect(nibm.locator('.loc-sugg-count')).toHaveText(/No listings/i);
  await expect(nibm).toHaveClass(/loc-sugg--empty/);

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('impossible locality ∩ near-a-place link auto-relaxes to proximity with a banner', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });

  // Magarpatta has 0 BUY listings in its own slug, but ~7 sit within 5km in
  // neighbouring slugs. A naive AND would show a cold "0 properties" page.
  const url =
    `${BASE}/listings?deal=buy&loc=magarpatta` +
    `&near=18.5159,73.9290&nearlabel=${encodeURIComponent('Magarpatta City')}`;
  await page.goto(url);

  // The recovery banner explains the relax and offers to keep just the area.
  const banner = page.getByText(/No exact matches in .* — showing places near/i);
  await expect(banner).toBeVisible({ timeout: 12000 });

  // Results are the proximity set, not an empty page.
  await expect(page.locator('a[href^="/property/"]').first()).toBeVisible({ timeout: 8000 });
  const cards = await page.locator('a[href^="/property/"]').count();
  expect(cards).toBeGreaterThan(0);

  // "Keep just the area near …" drops the contradicting locality from the URL.
  await page.getByRole('button', { name: /Keep just the area near/i }).click();
  await page.waitForFunction(() => !new URL(location.href).searchParams.get('loc'), null, {
    timeout: 6000,
  });
  expect(new URL(page.url()).searchParams.get('near')).toBeTruthy();
  // Banner is gone (no contradiction left) and results persist.
  await expect(banner).toBeHidden();
  await expect(page.locator('a[href^="/property/"]').first()).toBeVisible({ timeout: 8000 });

  expect(errors, errors.join('\n')).toHaveLength(0);
});
