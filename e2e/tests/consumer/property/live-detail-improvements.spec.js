import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* Property-detail improvement regression — the five fixes shipped this pass:
   #1 Honest locality value/rent benchmark (real ₹/sq.ft vs curated locality avg,
      neutral "no verified benchmark" note when we don't have the data).
   #2 Flatmate-split card on every multi-BHK residential rental (not a hardcoded few).
   #3 Share button confirms with a toast.
   #4 "EMI starts at" hidden for land buys.
   #5 "enquiries this week" is a weekly slice, not the lifetime total. */

/* Ids are the seeded slugs, and the locality of each is load-bearing rather than incidental.
   `frontend/src/data/localityIntel.js` benchmarks exactly ten localities, and the page prints a
   real comparison inside that set and a neutral note outside it - so both branches need a fixture
   that cannot be moved somewhere prettier without deleting the coverage it exists for. */
const SALE_FLAT_KNOWN = 'p5013';  // 1 BHK Flat, Baner - psf 9800 vs Baner benchmark 11500 -> "good deal"
const SALE_LAND = 'p5124';        // Open Plot, Wagholi (buy, land) - seeded 2026-08-19
const SALE_COMMERCIAL = 'p5101';  // Office Space, Baner (buy, commercial)
const RENT_2BHK_KNOWN = 'p5121';  // 2 BHK Flat, Wakad - benchmarked (rent2 27000) and priced under it
const RENT_NODATA_LOC = 'p5123';  // 3 BHK Flat, Balewadi - deliberately NOT in the benchmark set
const RENT_1BHK = 'p5122';        // 1 BHK Flat, Hinjawadi - too small to split
const RENT_COMMERCIAL = 'p5110';  // Warehouse / Godown for rent - not residential

async function collectErrors(page) {
  const errors = trackErrors(page);
  return errors;
}
function relevant(errors) {
  return errors.filter((e) => !/favicon|leaflet|tile|net::ERR|unsplash|maptiler|openstreetmap/i.test(e));
}

async function gotoProp(page, id) {
  await page.goto(`/property/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab').first().waitFor({ state: 'visible', timeout: 15000 });
  const reveal = async () => {
    await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
    /* The class is added synchronously by the `evaluate` above, and the reveal is an opacity
       transition rather than a mount -- `innerText` already sees the text. The sleep that used to
       sit here was waiting for an animation nothing reads. */
    return (await page.locator('body').innerText()).toLowerCase();
  };
  let combined = await reveal();
  const tabs = page.getByRole('tab');
  const count = await tabs.count();
  for (let i = 0; i < count; i++) {
    await tabs.nth(i).click();
    /* `reveal()` reads through `innerText()`, which does not retry, so this wait is load-bearing.
       The tab reporting itself selected is the panel swap this was really waiting for. */
    await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
    combined += '\n' + (await reveal());
  }
  return combined;
}

/* ---- Fix #1: honest locality benchmark ---- */

test('SALE flat in a benchmarked locality shows an honest ₹/sq.ft comparison', async ({ page }) => {
  const errors = await collectErrors(page);
  const txt = await gotoProp(page, SALE_FLAT_KNOWN);
  // Real locality average + a genuine value verdict (this listing is below Baner avg).
  expect(txt).toContain('baner average');
  expect(txt).toContain('good deal');
  expect(txt).toContain('below locality average');
  // Real appreciation figure from the curated locality (Baner yoy = 8.4%).
  expect(txt).toContain('8.4% appreciation over the last 12 months');
  expect(relevant(errors), relevant(errors).join('\n')).toHaveLength(0);
});

test('SALE land shows a neutral note, never a fabricated residential benchmark', async ({ page }) => {
  const txt = await gotoProp(page, SALE_LAND);
  expect(txt).toContain('publish a verified');
  expect(txt).toContain('rather than a guessed one');
  // No made-up "locality average / value rating" comparison for a plot.
  expect(txt).not.toContain('wagholi average');
  expect(txt).not.toContain('value rating');
});

test('SALE commercial shows a neutral note, not a residential ₹/sq.ft verdict', async ({ page }) => {
  const txt = await gotoProp(page, SALE_COMMERCIAL);
  expect(txt).toContain('publish a verified');
  expect(txt).not.toContain('baner average');
  expect(txt).not.toContain('good deal');
});

test('RENT flat in a benchmarked locality shows an honest rent rating', async ({ page }) => {
  const errors = await collectErrors(page);
  const txt = await gotoProp(page, RENT_2BHK_KNOWN);
  expect(txt).toContain('wakad average');
  expect(txt).toContain('rent rating');
  expect(txt).toMatch(/below market rent|above market rent|fair rent/);
  expect(relevant(errors), relevant(errors).join('\n')).toHaveLength(0);
});

test('RENT in a non-benchmarked locality shows a neutral note, not a guessed rent', async ({ page }) => {
  const txt = await gotoProp(page, RENT_NODATA_LOC);
  expect(txt).toContain('no verified balewadi rent benchmark');
  expect(txt).not.toContain('rent rating');
});

/* ---- Fix #2: flatmate-split card ---- */

test('Flatmate-split card appears on a multi-BHK residential rental', async ({ page }) => {
  const txt = await gotoProp(page, RENT_2BHK_KNOWN);
  expect(txt).toContain('sharing this flat');
});

test('Flatmate-split card is absent on a 1-BHK rental (not practical to split)', async ({ page }) => {
  const txt = await gotoProp(page, RENT_1BHK);
  expect(txt).not.toContain('sharing this flat');
});

test('Flatmate-split card is absent on a commercial rental', async ({ page }) => {
  const txt = await gotoProp(page, RENT_COMMERCIAL);
  expect(txt).not.toContain('sharing this flat');
});

/* ---- Fix #3: share toast ---- */

test('Share button confirms with a toast', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await gotoProp(page, SALE_FLAT_KNOWN);
  await page.getByRole('button', { name: 'Share' }).first().click();
  await expect(page.getByRole('alert').filter({ hasText: /link copied/i })).toBeVisible({ timeout: 5000 });
});

/* ---- Fix #4: EMI-starts-at hidden for land ---- */

test('"EMI starts at" is hidden on a land buy but shown on a flat buy', async ({ page }) => {
  const land = await gotoProp(page, SALE_LAND);
  expect(land).not.toContain('emi starts at');
  const flat = await gotoProp(page, SALE_FLAT_KNOWN);
  expect(flat).toContain('emi starts at');
});

/* ---- Fix #5: weekly enquiries slice ---- */

test('Live-activity shows a weekly enquiries slice below the lifetime total', async ({ page }) => {
  await gotoProp(page, SALE_FLAT_KNOWN);
  const weekLine = page.locator('span', { hasText: /enquiries this week/i }).first();
  await expect(weekLine).toBeVisible();
  const week = parseInt((await weekLine.innerText()).replace(/\D/g, ''), 10);
  // Shortlisted (lifetime enquiries) tile in the stat grid.
  const total = parseInt((await page.locator('text=Shortlisted').first().locator('..').innerText()).replace(/\D/g, ''), 10);
  expect(week).toBeGreaterThanOrEqual(1);
  expect(week).toBeLessThan(total);
});
