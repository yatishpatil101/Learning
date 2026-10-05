import { test, expect } from '../../../fixtures/live.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const urlParams = (page) => new URL(page.url()).searchParams;
const facetRequest = (page, match = () => true) => page.waitForRequest((r) => {
  if (!r.url().includes('/properties?')) return false;
  return match(new URL(r.url()).searchParams);
}, { timeout: 15000 });

const sameCsv = (actual, expected) => expect(String(actual).split(',').sort()).toEqual([...expected].sort());

async function apiTotal(request, params) {
  const url = new URL(`${BASE}/api/properties`);
  Object.entries({ ...params, size: '1' }).forEach(([key, value]) => url.searchParams.set(key, value));
  const res = await request.get(url.toString());
  expect(res.ok(), `${url.pathname}?${url.searchParams} returned ${res.status()}`).toBeTruthy();
  return (await res.json()).totalElements;
}

async function expectNarrows(request, baseParams, facetParams, label) {
  const base = await apiTotal(request, baseParams);
  const narrowed = await apiTotal(request, { ...baseParams, ...facetParams });
  expect(narrowed, `${label} should leave real matches`).toBeGreaterThan(0);
  expect(narrowed, `${label} should narrow ${JSON.stringify(baseParams)}`).toBeLessThan(base);
}

async function requestFor(page, path, match) {
  const sent = facetRequest(page, match);
  await page.goto(path);
  return new URL((await sent).url()).searchParams;
}

async function reloadAndCapture(page, match) {
  const sent = facetRequest(page, match);
  await page.reload();
  return new URL((await sent).url()).searchParams;
}

async function sortBy(page, label) {
  await page.getByRole('button', { name: /sort/i }).first().click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function pickPropertyType(page, key) {
  await filters(page).locator(`label[for$="type-${key}"]`).click();
}

test('residential facets reach the wire, narrow, and survive reload', async ({ page, request }) => {
  await expectNarrows(request, { deal: 'rent', types: 'flat' }, { food: 'nonveg' }, 'food=nonveg');
  await expectNarrows(request, { deal: 'rent', types: 'flat' }, { food: 'veg' }, 'food=veg');
  await expectNarrows(request, { deal: 'rent', types: 'flat' }, { facing: 'east' }, 'facing=east');
  await expectNarrows(request, { deal: 'buy', types: 'villa' }, { minBaths: '4' }, 'minBaths=4');

  const q = await requestFor(page, '/listings?deal=rent&ptype=flat&facing=east,north&minBaths=3&food=nonveg', (p) => p.get('food') === 'nonveg');

  sameCsv(q.get('facing'), ['east', 'north']);
  expect(q.get('minBaths')).toBe('3');
  expect(q.get('food')).toBe('nonveg');

  const afterReload = await reloadAndCapture(page, (p) => p.get('food') === 'nonveg');
  sameCsv(afterReload.get('facing'), ['east', 'north']);
  expect(urlParams(page).get('minBaths')).toBe('3');
  expect(urlParams(page).get('food')).toBe('nonveg');
});

test('food preference is a single pick of Veg / Jain / Non-veg that reaches the wire', async ({ page }) => {
  await page.goto('/listings?deal=rent&ptype=flat');
  await filters(page).getByRole('button', { name: /Food preference/ }).click();
  const chip = (name) => filters(page).getByRole('button', { name, exact: true });

  const jain = facetRequest(page, (p) => p.get('food') === 'jain');
  await chip('Jain only').click();
  await jain;
  await expect(page.getByRole('button', { name: /Remove filter Jain only/i })).toBeVisible();
  expect(urlParams(page).get('food')).toBe('jain');

  const veg = facetRequest(page, (p) => p.get('food') === 'veg');
  await chip('Veg only').click();
  await veg;
  await expect(page.getByRole('button', { name: /Remove filter Jain only/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Remove filter Veg only/i })).toBeVisible();

  await chip('Veg only').click();
  await expect(page.getByRole('button', { name: /Remove filter Veg only/i })).toHaveCount(0);
  await expect(page).not.toHaveURL(/food=/);
});

test('facing offers the four cardinals as checkboxes that reach the wire', async ({ page }) => {
  await page.goto('/listings?deal=rent&ptype=flat');
  await filters(page).getByRole('button', { name: /^Facing/ }).click();
  await expect(filters(page).locator('label[for*="facing-"]')).toHaveText(['East', 'West', 'North', 'South']);
  const north = filters(page).locator('input[type="checkbox"][id$="facing-north"]');
  await expect(north).not.toBeChecked();

  const sent = facetRequest(page, (p) => p.get('facing') === 'north');
  await filters(page).locator('label[for$="facing-north"]').click();
  await sent;
  await expect(north).toBeChecked();
  expect(urlParams(page).get('facing')).toBe('north');
});

test('commercial facets narrow and are gated by deal and type', async ({ page, request }) => {
  await expectNarrows(request, { deal: 'buy', types: 'commercial' }, { shell: 'bareShell' }, 'shell=bareShell');
  await expectNarrows(request, { deal: 'buy', types: 'commercial' }, { preLeased: 'true' }, 'preLeased=true');

  const buy = await requestFor(page, '/listings?deal=buy&ptype=commercial&shell=bareShell,warmShell&preLeased=true', (p) => p.get('preLeased') === 'true');

  sameCsv(buy.get('shell'), ['bareShell', 'warmShell']);
  expect(buy.get('preLeased')).toBe('true');

  await reloadAndCapture(page, (p) => p.get('preLeased') === 'true');
  expect(urlParams(page).get('preLeased')).toBe('true');

  const rent = await requestFor(page, '/listings?deal=rent&ptype=commercial&shell=furnished&preLeased=true', (p) => p.get('shell') === 'furnished');
  expect(rent.get('shell')).toBe('furnished');
  expect(rent.has('preLeased')).toBe(false);
  await expect.poll(() => urlParams(page).has('preLeased'), { timeout: 15000 }).toBe(false);
});

test('land facets narrow and use square feet on the wire', async ({ page, request }) => {
  await expectNarrows(request, { deal: 'buy', types: 'farmland' }, { na: 'deemed' }, 'na=deemed');
  await expectNarrows(request, { deal: 'buy', types: 'farmland' }, { minArea: '87120' }, 'minArea=87120');

  const untouched = await requestFor(page, '/listings?deal=buy&ptype=farmland', (p) => p.get('types') === 'farmland');
  expect(untouched.has('minArea')).toBe(false);
  expect(untouched.has('maxArea')).toBe(false);
  expect(urlParams(page).has('area')).toBe(false);

  const q = await requestFor(page, '/listings?deal=buy&ptype=farmland&na=deemed,sanctioned&areaUnit=acre&area=2-20', (p) => p.get('minArea') === '87120');

  sameCsv(q.get('na'), ['deemed', 'sanctioned']);
  expect(q.get('minArea')).toBe('87120');
  expect(q.has('maxArea')).toBe(false);
  expect(urlParams(page).get('area')).toBe('2-20');
  expect(urlParams(page).get('areaUnit')).toBe('acre');

  const afterReload = await reloadAndCapture(page, (p) => p.get('minArea') === '87120');
  expect(afterReload.get('minArea')).toBe('87120');
  expect(urlParams(page).get('area')).toBe('2-20');
  expect(urlParams(page).get('areaUnit')).toBe('acre');
});

test('area defaults reset on type and unit changes', async ({ page }) => {
  await page.goto('/listings?deal=buy&ptype=flat&area=500-1500');

  const toMixed = facetRequest(page, (p) => !p.has('minArea') && !p.has('maxArea'));
  await pickPropertyType(page, 'farmland');
  const mixed = new URL((await toMixed).url()).searchParams;
  expect(mixed.has('minArea')).toBe(false);
  expect(mixed.has('maxArea')).toBe(false);
  await expect.poll(() => String(urlParams(page).get('ptype')).includes('farmland'), { timeout: 15000 }).toBe(true);
  expect(urlParams(page).has('area')).toBe(false);

  const toFarmland = facetRequest(page, (p) => !p.has('minArea') && !p.has('maxArea'));
  await page.getByRole('button', { name: 'Remove filter Flat', exact: true }).click();
  const farmland = new URL((await toFarmland).url()).searchParams;
  expect(farmland.has('minArea')).toBe(false);
  expect(farmland.has('maxArea')).toBe(false);
  await expect.poll(() => urlParams(page).get('ptype'), { timeout: 15000 }).toBe('farmland');
  expect(urlParams(page).has('area')).toBe(false);
  expect(urlParams(page).has('areaUnit')).toBe(false);

  await page.goto('/listings?deal=buy&ptype=farmland&areaUnit=guntha&area=3-80');
  await filters(page).getByRole('button', { name: /land area/i }).first().click();
  const unitReset = facetRequest(page, (p) => !p.has('minArea') && !p.has('maxArea'));
  await filters(page).getByRole('button', { name: 'acre', exact: true }).click();
  const unitChanged = new URL((await unitReset).url()).searchParams;
  expect(unitChanged.has('minArea')).toBe(false);
  expect(unitChanged.has('maxArea')).toBe(false);
  await expect.poll(() => urlParams(page).has('area'), { timeout: 15000 }).toBe(false);
});

test('legacy posted-by URLs are ignored and cleaned up', async ({ page }) => {
  const q = await requestFor(page, '/listings?deal=rent&postedBy=agent', (p) => !p.has('postedBy'));

  expect(q.has('postedBy')).toBe(false);
  await expect.poll(() => urlParams(page).has('postedBy'), { timeout: 15000 }).toBe(false);
  await expect(page.getByRole('button', { name: /remove filter agent/i })).toHaveCount(0);
  expect(urlParams(page).has('postedByOwner')).toBe(false);
  expect(urlParams(page).has('owneronly')).toBe(false);
});

test('new sorts send rank values', async ({ page }) => {
  await page.goto('/listings?deal=buy');

  const psf = facetRequest(page, (p) => p.get('rank') === 'pricePerSqft');
  await sortBy(page, 'Price per sq ft (low to high)');
  expect(new URL((await psf).url()).searchParams.get('rank')).toBe('pricePerSqft');

  const verified = facetRequest(page, (p) => p.get('rank') === 'verified');
  await sortBy(page, 'Verified first');
  expect(new URL((await verified).url()).searchParams.get('rank')).toBe('verified');
});
