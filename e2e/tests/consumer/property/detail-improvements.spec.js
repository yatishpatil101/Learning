import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';
import { API } from '../../../helpers/liveAuth.js';

/* The benchmark is the server's listing-derived locality stats (null below three live listings), so
   each assertion follows what `GET /localities/<slug>` says rather than a fixed figure. */
const SALE_FLAT_KNOWN = 'p5013';  // 1 BHK Flat, Baner
const SALE_LAND = 'p5124';        // Open Plot, Wagholi (buy, land) - seeded 2026-08-19
const SALE_COMMERCIAL = 'p5101';  // Office Space, Baner (buy, commercial)
const RENT_2BHK_KNOWN = 'p5121';  // 2 BHK Flat, Wakad
const RENT_NODATA_LOC = 'p5123';  // 3 BHK Flat, Balewadi
const RENT_1BHK = 'p5122';        // 1 BHK Flat, Hinjawadi - too small to split
const RENT_COMMERCIAL = 'p5110';  // Warehouse / Godown for rent - not residential

const collectErrors = async (page) => trackErrors(page);
function relevant(errors) {
  return errors.filter((e) => !/favicon|leaflet|tile|net::ERR|unsplash|maptiler|openstreetmap/i.test(e));
}

const statsOf = async (slug) => (await fetch(`${API}/localities/${slug}`)).json();

const RETIRED_INTEL = ['appreciation', 'livability', "what's nearby", 'market rate'];

async function gotoProp(page, id) {
  await page.goto(`/property/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab').first().waitFor({ state: 'visible', timeout: 15000 });
  const reveal = async () => {
    await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
    return (await page.locator('body').innerText()).toLowerCase();
  };
  let combined = await reveal();
  const tabs = page.getByRole('tab');
  const count = await tabs.count();
  for (let i = 0; i < count; i++) {
    await tabs.nth(i).click();
    // `innerText()` does not retry, so wait for the panel swap before reading.
    await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
    combined += '\n' + (await reveal());
  }
  return combined;
}

test('a sale flat compares with the locality only when the server has stats, shares with a toast, offers EMI, counts lifetime enquiries and is reached by one breadcrumb', async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = await collectErrors(page);
  const txt = await gotoProp(page, SALE_FLAT_KNOWN);

  await test.step('the ₹/sq.ft comparison exists exactly when the locality has a listing-derived rate', async () => {
    const { ratePerSqft } = await statsOf('baner');
    if (ratePerSqft != null) {
      expect(txt).toContain('baner average');
      expect(txt).toContain('value rating');
    } else {
      expect(txt).not.toContain('baner average');
      expect(txt).toContain('no baner price benchmark for this listing yet');
    }
    for (const gone of RETIRED_INTEL) expect(txt).not.toContain(gone);
    expect(relevant(errors), relevant(errors).join('\n')).toHaveLength(0);
  });

  await test.step('home-loan framing is offered on a flat buy', async () => {
    expect(txt).toContain('calculate emi');
  });

  await test.step('header shows only lifetime enquiries, not a weekly activity slice', async () => {
    const enquiries = page.locator('.dz-stat-social > *', { hasText: 'Enquiries' }).first();
    await expect(enquiries).toBeVisible();
    expect(parseInt((await enquiries.innerText()).replace(/\D/g, ''), 10)).toBeGreaterThan(0);
    await expect(page.getByText(/enquiries this week/i)).toHaveCount(0);
    await expect(page.getByText('Shortlisted', { exact: true })).toHaveCount(0);
  });

  await test.step('up-navigation is the breadcrumb, and nothing repeats it', async () => {
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Buy' })).toHaveAttribute('href', /deal=buy|\/listings/);
    await expect(page.getByRole('button', { name: /back to (results|map)/i })).toHaveCount(0);
  });

  await test.step('Share button confirms with a toast', async () => {
    await page.getByRole('button', { name: 'Share' }).first().click();
    await expect(page.getByRole('alert').filter({ hasText: /link copied/i })).toBeVisible({ timeout: 5000 });
  });
});

test('a sale plot shows a neutral note, never a fabricated residential benchmark, and no home-loan framing', async ({ page }) => {
  const txt = await gotoProp(page, SALE_LAND);
  expect(txt).toContain('no wagholi price benchmark for this listing yet');
  // No made-up "locality average / value rating" comparison for a plot.
  expect(txt).not.toContain('wagholi average');
  expect(txt).not.toContain('value rating');
  expect(txt).not.toContain('calculate emi');
});

test('a rent flat shows the locality average rent only when the server has one, and the flatmate-split card', async ({ page }) => {
  const errors = await collectErrors(page);
  const txt = await gotoProp(page, RENT_2BHK_KNOWN);

  await test.step('the locality average rent tile follows the server stats', async () => {
    const { avgRent } = await statsOf('wakad');
    if (avgRent != null) {
      await expect(page.getByTestId('rent-locality-avg')).toBeVisible();
      expect(txt).toContain('avg rent in wakad');
    } else {
      expect(txt).not.toContain('avg rent in wakad');
    }
    expect(txt).not.toContain('rent rating');
    expect(relevant(errors), relevant(errors).join('\n')).toHaveLength(0);
  });

  await test.step('Flatmate-split card appears on a multi-BHK residential rental', async () => {
    expect(txt).toContain('sharing this flat');
  });
});

test('where there is no benchmark the page says so, and where a rental is not splittable it offers no flatmate split', async ({ page }) => {
  test.slow();

  await test.step('SALE commercial shows a neutral note, not a residential ₹/sq.ft verdict', async () => {
    const txt = await gotoProp(page, SALE_COMMERCIAL);
    expect(txt).toContain('no baner price benchmark for this listing yet');
    expect(txt).not.toContain('baner average');
    expect(txt).not.toContain('good deal');
  });

  await test.step('RENT never shows a guessed average where the locality has too few listings', async () => {
    const { avgRent } = await statsOf('balewadi');
    const txt = await gotoProp(page, RENT_NODATA_LOC);
    if (avgRent == null) expect(txt).not.toContain('avg rent in balewadi');
    expect(txt).not.toContain('rent rating');
  });

  await test.step('Flatmate-split card is absent on a 1-BHK rental (not practical to split)', async () => {
    expect(await gotoProp(page, RENT_1BHK)).not.toContain('sharing this flat');
  });

  await test.step('Flatmate-split card is absent on a commercial rental', async () => {
    expect(await gotoProp(page, RENT_COMMERCIAL)).not.toContain('sharing this flat');
  });
});
