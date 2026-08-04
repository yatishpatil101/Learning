import { test, expect } from '@playwright/test';

/* SALE property-detail regression:
   - RENT-only blocks never leak onto a SALE page
   - SALE-critical options are present
   - land/plot listings hide apartment-only sections (bedrooms, floor plan, society)
   - no console errors */

const SALE_FLAT = 'P5013';       // 1 BHK Flat in Baner (buy)
const SALE_PLOT = 'P5100';       // Residential Open Plot in Wagholi (buy, land)
const RENT_FLAT = 'P5014';       // 3 BHK Penthouse (rent)

async function collectErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  return errors;
}

function relevant(errors) {
  return errors.filter((e) => !/favicon|leaflet|tile|net::ERR|unsplash|maptiler|openstreetmap/i.test(e));
}

async function gotoProp(page, id) {
  await page.goto(`/property/${id}`, { waitUntil: 'networkidle' });
  // The mock API resolves asynchronously *after* networkidle (it's a setTimeout,
  // not a network call), so a fixed wait races the loading skeleton. Wait for the
  // property content — the tab bar — to actually render before collecting text.
  await page.getByRole('tab').first().waitFor({ state: 'visible', timeout: 15000 });
  // Content is now grouped into tabs — click through every tab and accumulate the
  // rendered text so "does this block exist for this deal type" assertions still hold.
  const reveal = async () => {
    await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
    await page.waitForTimeout(150);
    return (await page.locator('body').innerText()).toLowerCase();
  };
  let combined = await reveal();
  const tabs = page.getByRole('tab');
  const count = await tabs.count();
  for (let i = 0; i < count; i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(300);
    combined += '\n' + (await reveal());
  }
  return combined;
}

test('SALE flat: no rent-only blocks, sale options present, no errors', async ({ page }) => {
  const errors = await collectErrors(page);
  const txt = await gotoProp(page, SALE_FLAT);

  for (const leak of ['rent details', 'preferred tenants', 'monthly rent', 'lock-in', 'get rent agreement', 'find flatmates', 'sharing this flat']) {
    expect(txt, `rent-only block leaked: ${leak}`).not.toContain(leak);
  }
  for (const want of ['for sale', 'price insights', 'affordability', 'documents provided by owner', 'key details']) {
    expect(txt, `sale option missing: ${want}`).toContain(want);
  }
  // Schedule-a-visit is promoted in the sidebar for sale.
  await expect(page.getByRole('button', { name: /schedule a visit/i }).first()).toBeVisible();
  expect(relevant(errors), relevant(errors).join('\n')).toHaveLength(0);
});

test('SALE plot: apartment-only sections hidden', async ({ page }) => {
  const errors = await collectErrors(page);
  const txt = await gotoProp(page, SALE_PLOT);

  for (const irrelevant of ['bedrooms', 'floor plan', 'society information', 'preferred tenants', 'balconies']) {
    expect(txt, `land page should not show: ${irrelevant}`).not.toContain(irrelevant);
  }
  // Land-specific details should appear instead.
  expect(txt).toContain('plot area');
  expect(txt).toContain('plot zone');
  expect(relevant(errors), relevant(errors).join('\n')).toHaveLength(0);
});

test('RENT flat still shows rent-only blocks (guard against over-hiding)', async ({ page }) => {
  const txt = await gotoProp(page, RENT_FLAT);
  expect(txt).toContain('rent details');
  expect(txt).toContain('preferred tenants');
  expect(txt).not.toContain('price insights');
});

test('Commercial rent shows owner-declared, sub-type-specific fit-out fixtures', async ({ page }) => {
  const errors = await collectErrors(page);
  const txt = await gotoProp(page, 'C6107'); // Warehouse / Godown for rent (industrial profile)
  // Fit-out is spoken in commercial terms, and the warehouse's real fixtures surface —
  // never the residential furniture list.
  expect(txt).toContain('fit-out & fixtures');
  expect(txt).toContain('loading bay / dock');
  expect(txt).not.toContain('wardrobes');
  expect(relevant(errors), relevant(errors).join('\n')).toHaveLength(0);
});
