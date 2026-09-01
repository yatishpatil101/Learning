import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* Homepage hero — unified multi-entity search.
   One box searches LOCALITIES / SOCIETIES / LANDMARKS (no cap). Suggestions are
   registry-backed (no Google needed); societies & landmarks are GATED to live
   listing counts so a pick can never dead-end. This spec verifies:
   (1) localities tokenize into chips and Search emits the `?loc=` contract;
   (2) Backspace removes the last chip;
   (3) whatever society/landmark suggestions the seed exposes route via
       `?soc=` / `?near=` and land on non-empty, filtered Listings;
   all with zero console errors. */

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

// Read the currently visible suggestion rows as {label, kindLabel}.
async function readSuggestions(page) {
  return page.$$eval(`${HERO} .loc-sugg`, (rows) =>
    rows.map((r) => ({
      label: r.querySelector('.truncate')?.textContent?.trim() || '',
      kind: (r.querySelector('.loc-sugg-kind')?.textContent || '').trim(),
    })),
  );
}

test('localities tokenize into chips and Search emits the ?loc= contract', async ({ page }) => {
  const errors = await gotoHome(page);
  const input = page.locator(`${HERO} ${INPUT}`);

  const pick = async (typed, name) => {
    await input.fill(typed);
    const row = page.locator(`${HERO} .loc-sugg`, { hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 6000 });
    await row.click();
  };

  await pick('Wakad', 'Wakad');
  await pick('Baner', 'Baner');
  await pick('Hinj', 'Hinjawadi');

  // Three chips chosen → the input stays available (no cap) so more can be added.
  await expect(page.locator(`${HERO} .loc-chip`)).toHaveCount(3);
  await expect(input).toBeVisible();

  await page.locator(`${HERO} .search-btn`).click();
  await page.waitForURL(/\/listings\?/, { timeout: 8000 });
  const url = new URL(page.url());
  expect(url.searchParams.get('deal')).toBe('buy');
  const loc = url.searchParams.get('loc') || '';
  expect(loc.split(',').filter(Boolean)).toHaveLength(3);

  // Chosen entities render as removable chips on Listings.
  await expect(page.locator('main').getByText('Wakad', { exact: false }).first()).toBeVisible({ timeout: 8000 });
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('Backspace on an empty query removes the last chip', async ({ page }) => {
  const errors = await gotoHome(page);
  const input = page.locator(`${HERO} ${INPUT}`);

  await input.fill('Wakad');
  await page.locator(`${HERO} .loc-sugg`, { hasText: 'Wakad' }).first().click();
  await input.fill('Baner');
  await page.locator(`${HERO} .loc-sugg`, { hasText: 'Baner' }).first().click();
  await expect(page.locator(`${HERO} .loc-chip`)).toHaveCount(2);

  await input.press('Backspace');
  await expect(page.locator(`${HERO} .loc-chip`)).toHaveCount(1);
  await expect(page.locator(`${HERO} .loc-chip`)).toContainText('Wakad');
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('society & landmark suggestions (when seeded) route via ?soc= / ?near= to non-empty results', async ({ page }) => {
  const errors = await gotoHome(page);
  const input = page.locator(`${HERO} ${INPUT}`);

  // Probe the seed: which kinds surface for a broad set of letters?
  const found = { society: null, landmark: null };
  for (const ch of 'abcdefghijklmnoprstuvw'.split('')) {
    if (found.society && found.landmark) break;
    await input.fill(ch);
    await page.waitForTimeout(120);
    const rows = await readSuggestions(page);
    for (const r of rows) {
      if (!found.society && /^Society/.test(r.kind)) found.society = r.label;
      if (!found.landmark && /^Landmark/.test(r.kind)) found.landmark = r.label;
    }
  }

  const exercise = async (name, param, extra = []) => {
    await input.fill(name.slice(0, Math.max(3, Math.min(name.length, 6))));
    const row = page.locator(`${HERO} .loc-sugg`, { hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 6000 });
    await row.click();
    await expect(page.locator(`${HERO} .loc-chip`, { hasText: name })).toBeVisible();
    await page.locator(`${HERO} .search-btn`).click();
    await page.waitForURL(/\/listings\?/, { timeout: 8000 });
    const sp = new URL(page.url()).searchParams;
    expect(sp.get(param)).toBeTruthy();
    // A society/landmark pick also carries context into Listings: a society brings
    // its parent locality (?loc=), a landmark brings a human name (?nearlabel=).
    for (const k of extra) expect(sp.get(k), `expected ?${k}= for "${name}"`).toBeTruthy();
    // A gated suggestion must yield at least one result card (never a dead-end).
    await expect(page.locator('a[href^="/property/"]').first())
      .toBeVisible({ timeout: 8000 });
    await page.goto(`${BASE}/`);
    await page.locator(HERO).waitFor({ timeout: 10000 });
  };

  test.skip(!found.society && !found.landmark, 'seed exposes no gated society/landmark suggestions');
  if (found.society) await exercise(found.society, 'soc', ['loc']);
  if (found.landmark) await exercise(found.landmark, 'near', ['nearlabel']);

  expect(errors, errors.join('\n')).toHaveLength(0);
});
