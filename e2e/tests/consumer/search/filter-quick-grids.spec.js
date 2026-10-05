import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const urlParams = (page) => new URL(page.url()).searchParams;

const gridReport = (page) => filters(page).locator('.filter-group .grid').evaluateAll((grids) => grids.map((g) => ({
  group: g.closest('.filter-group').querySelector('.fg-header').childNodes[1]?.textContent.trim(),
  columns: getComputedStyle(g).gridTemplateColumns.split(' ').length,
  overflow: [...g.children].filter((cell) => {
    const label = cell.querySelector('label');
    return label && label.getBoundingClientRect().right > cell.getBoundingClientRect().right + 1;
  }).map((cell) => cell.textContent.trim()),
})));

const groupTitles = (page) => filters(page).locator('.fg-header').evaluateAll((els) => els.map((el) => {
  const copy = el.cloneNode(true);
  copy.querySelector('.fg-summary')?.remove();
  return copy.textContent.trim();
}));
const PAGES = [
  ['rent homes', '/listings?deal=rent'],
  ['buy homes', '/listings?deal=buy'],
  ['commercial', '/listings?deal=buy&ptype=commercial'],
  ['plots', '/listings?deal=buy&ptype=plot'],
  ['rent commercial', '/listings?deal=rent&ptype=commercial'],
];

for (const [name, path] of PAGES) {
  test(`${name}: option grids are two-up, labels stay in their cell, only searchable lists are dropdowns`, async ({ page }) => {
    await page.goto(`${BASE}${path}`);
    await filters(page).locator('.fg-header').first().waitFor();
    const grids = await gridReport(page);
    expect(grids.length).toBeGreaterThan(2);
    for (const g of grids) {
      expect(g.columns, `${g.group} should be two columns`).toBe(2);
      expect(g.overflow, `${g.group} labels overflow their cell`).toEqual([]);
    }
    await expect(filters(page).locator('.dz-dropdown__trigger')).toHaveCount(2);
    await expect(filters(page).getByRole('button', { name: 'Amenities', exact: true })).toHaveCount(0);
  });
}

test('Amenities are quick checkboxes, and Pet-friendly drives the pets flag on Rent', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent`);
  await filters(page).locator('.fg-header').filter({ hasText: 'Amenities' }).click();
  const box = (key) => filters(page).locator(`label[for$="amen-${key}"]`);

  await box('lift').click();
  await box('pet').click();
  await expect(page.getByRole('button', { name: /Remove filter Lift/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Remove filter Pet-friendly/i })).toBeVisible();
  await expect.poll(() => urlParams(page).get('pets')).toBeTruthy();

  await box('pet').click();
  await expect(page.getByRole('button', { name: /Remove filter Pet-friendly/i })).toHaveCount(0);
  await expect(filters(page).locator('input[id$="amen-lift"]')).toBeChecked();
});

test('Buy possession status is a multi-select checkbox grid', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=buy`);
  const box = (key) => filters(page).locator(`label[for$="possession-${key}"]`);
  await box('ready').click();
  await box('under').click();
  await expect(filters(page).locator('input[id$="possession-ready"]')).toBeChecked();
  await expect(filters(page).locator('input[id$="possession-under"]')).toBeChecked();
});

test('Filter groups keep their order: rent leads with rent and tenants, buy shows no tenant filter', async ({ page }) => {
  await test.step('Rent filters lead with rent, localities, property type, tenants, BHK, furnishing, available-from', async () => {
    await page.goto(`${BASE}/listings?deal=rent`);
    await filters(page).locator('.fg-header').first().waitFor();
    const titles = await groupTitles(page);
    expect(titles.slice(0, 8)).toEqual([
      'Monthly Rent', 'Localities', 'Property type', 'Preferred Tenants', 'BHK / Room Type', 'Furnishing', 'Available From', 'Near a Place',
    ]);
    expect(titles.filter((x) => x === 'Preferred Tenants')).toHaveLength(1);
  });

  await test.step('Buy filters keep their order and show no tenant filter', async () => {
    await page.goto(`${BASE}/listings?deal=buy`);
    await filters(page).locator('.fg-header').first().waitFor();
    const titles = await groupTitles(page);
    expect(titles).not.toContain('Preferred Tenants');
    expect(titles.indexOf('Near a Place')).toBeLessThan(titles.indexOf('Property type'));
    expect(titles.indexOf('Property type')).toBeLessThan(titles.indexOf('BHK Type'));
    expect(titles.indexOf('BHK Type')).toBeLessThan(titles.indexOf('Furnishing'));
  });
});

test('Preferred Tenants is a multi-select checkbox grid that toggles chips', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent`);
  const box = (key) => filters(page).locator(`label[for$="tenant-${key}"]`);
  await expect(filters(page).getByRole('button', { name: 'Preferred Tenants', exact: true })).toHaveCount(0);

  await box('family').click();
  await box('company').click();
  await expect(page.getByRole('button', { name: /Remove filter Family/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Remove filter Company/i })).toBeVisible();

  await box('family').click();
  await expect(page.getByRole('button', { name: /Remove filter Family/i })).toHaveCount(0);
  await expect(filters(page).locator('input[id$="tenant-company"]')).toBeChecked();
});