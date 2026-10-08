import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';
import { stockBySlug } from '../../../helpers/locality.js';

/* Location search never dead-ends: suggestions carry a live listing-count badge, and Listings auto-relaxes an
   impossible locality and near-a-place combination to the proximity intent with a dismissible banner. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const HERO = '.hero-search-wrap';
const INPUT = 'input[aria-label="Search localities, societies or landmarks"]';

async function gotoHome(page) {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/`);
  await page.locator(HERO).waitFor({ timeout: 15000 });
  return errors;
}

const POPULAR = [['Baner', 'baner'], ['Wakad', 'wakad'], ['Hinjawadi', 'hinjawadi'], ['Kothrud', 'kothrud'], ['Koregaon Park', 'koregaon-park'], ['Viman Nagar', 'viman-nagar']];

test('home suggestions show a live listing-count badge (stocked vs empty)', async ({ page }) => {
  const errors = await gotoHome(page);
  const stock = await stockBySlug('buy');
  const input = page.locator(`${HERO} ${INPUT}`);
  const row = (name) => page.locator(`${HERO} .loc-sugg`, { hasText: name }).first();

  // Typed names are offered only from live stock, so the empty state lives in the popular list.
  expect(stock.get('baner')?.count || 0, 'Baner holds no buy stock, so there is no stocked row to compare').toBeGreaterThan(0);
  expect(POPULAR.filter(([, slug]) => !stock.get(slug)?.count).length, 'every popular locality has buy stock, so there is no empty row to show').toBeGreaterThan(0);

  await input.click();
  for (const [name, slug] of POPULAR) {
    const n = stock.get(slug)?.count || 0;
    await expect(row(name)).toBeVisible({ timeout: 6000 });
    await expect(row(name).locator('.loc-sugg-count'), `${name} badge`).toHaveText(n ? new RegExp(`^${n}\\s+listings?$`) : /No listings/i);
    if (n) await expect(row(name)).not.toHaveClass(/loc-sugg--empty/);
    else await expect(row(name)).toHaveClass(/loc-sugg--empty/);
  }

  await input.fill('Baner');
  await expect(row('Baner').locator('.loc-sugg-count')).toHaveText(/\d+\s+listing/);

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
