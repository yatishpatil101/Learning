import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const landUseLabel = (page, key) => filters(page).locator(`label[for$="landuse-${key}"]`);
const landUseInput = (page, key) => filters(page).locator(`input[id$="landuse-${key}"]`);
const typeLabel = (page, key) => filters(page).locator(`label[for$="type-${key}"]`);
const typeInput = (page, key) => filters(page).locator(`input[id$="type-${key}"]`);
/* `.fg-header` is the button INSIDE the <h4>, never the <h4> itself. */
const groupHeading = (page, name) => filters(page).locator('.fg-header').filter({ hasText: name });
const cards = (page) => page.locator('a[href^="/property/"]');

test('Filter groups follow the property type (Land, Commercial, Residential)', async ({ page }) => {
  await test.step('Land property type reveals Land Use and hides residential-only filters', async () => {
    await page.goto(`${BASE}/listings?type=plot`);
    await expect(typeInput(page, 'plot')).toBeChecked();

    await expect(groupHeading(page, 'Land use')).toBeVisible();
    await expect(groupHeading(page, 'BHK Type')).toHaveCount(0);
    await expect(groupHeading(page, 'Furnishing')).toHaveCount(0);
    await expect(groupHeading(page, 'Construction Status')).toHaveCount(0);
  });

  await test.step('Commercial hides BHK, keeps Furnishing, and never shows Land Use', async () => {
    await page.goto(`${BASE}/listings?type=commercial`);
    await expect(groupHeading(page, 'Commercial type')).toBeVisible();

    await expect(groupHeading(page, 'BHK Type')).toHaveCount(0);
    await expect(groupHeading(page, 'Furnishing')).toBeVisible();
    await expect(groupHeading(page, 'Land use')).toHaveCount(0);
  });

  await test.step('Residential type keeps BHK and shows no Land Use filter', async () => {
    await page.goto(`${BASE}/listings?type=flat`);
    await expect(groupHeading(page, 'BHK Type')).toBeVisible();
    await expect(groupHeading(page, 'Land use')).toHaveCount(0);
  });
});

const cardHrefs = (page) => cards(page).evaluateAll((els) => els.map((el) => el.getAttribute('href')));
const apiHrefs = async (request, params) => {
  const url = new URL(`${BASE}/api/properties`);
  Object.entries({ ...params, page: '0', size: '24', rank: 'relevance' }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  const res = await request.get(url.toString());
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.content.map((row) => `/property/${row.slug || row.id}`);
};

test('Land Use filter narrows results and renders a removable chip', async ({ page }) => {
  await page.goto(`${BASE}/listings?type=plot`);
  await cards(page).first().waitFor({ timeout: 10000 });
  const before = await cardHrefs(page);
  expect(before.length).toBeGreaterThan(1);
  // p5131 is the only commercially zoned plot in the seed, so it must be in the
  // unfiltered grid before the filter can be said to have kept it.
  expect(before).toContain('/property/p5131');

  await landUseLabel(page, 'commercial').click();

  await expect(page.getByRole('button', { name: /Remove filter Commercial/i })).toBeVisible();

  await expect.poll(async () => await cardHrefs(page), { timeout: 10000 })
    .toEqual(['/property/p5131']);
});

test('Land Use reflects the zoning the server stated, not a hash of the slug', async ({ page, request }) => {
  const expected = await apiHrefs(request, { deal: 'buy', types: 'plot', landUse: 'residential' });
  await page.goto(`${BASE}/listings?type=plot`);
  await cards(page).first().waitFor({ timeout: 10000 });
  expect(await cardHrefs(page)).toContain('/property/p5124');

  await landUseLabel(page, 'residential').click();

  await expect.poll(async () => await cardHrefs(page), { timeout: 10000 })
    .toEqual(expected);
  expect(expected).toContain('/property/p5124');
});

test('Land use and Property type are multi-select checkbox grids that toggle chips', async ({ page }) => {
  await test.step('Land use', async () => {
    await page.goto(`${BASE}/listings?type=plot`);
    await expect(filters(page).getByRole('button', { name: 'Land use', exact: true })).toHaveCount(0);

    await landUseLabel(page, 'residential').click();
    await landUseLabel(page, 'agricultural').click();
    await expect(page.getByRole('button', { name: /Remove filter Residential/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Remove filter Agricultural/i })).toBeVisible();

    await landUseLabel(page, 'residential').click();
    await expect(page.getByRole('button', { name: /Remove filter Residential/i })).toHaveCount(0);
    await expect(landUseInput(page, 'agricultural')).toBeChecked();
  });

  await test.step('Property type', async () => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await expect(filters(page).getByRole('button', { name: 'Property type', exact: true })).toHaveCount(0);

    await typeLabel(page, 'villa').click();
    await typeLabel(page, 'flat').click();
    await expect(page.getByRole('button', { name: /Remove filter Villa/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Remove filter Flat/i })).toBeVisible();

    await typeLabel(page, 'villa').click();
    await expect(page.getByRole('button', { name: /Remove filter Villa/i })).toHaveCount(0);
    await expect(typeInput(page, 'flat')).toBeChecked();
  });
});
