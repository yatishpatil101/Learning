import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const POINT = 'near=18.559%2C73.776&nearlabel=Baner';

const filters = (page) => page.locator('#sf-desktop-filters');
const radiusField = (page) => filters(page).getByLabel('Search radius value');

async function openNear(page, query) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/flatmates?view=move-in&${query}`);
  await page.locator('.sf-card').first().waitFor({ timeout: 15000 });
  const toggle = page.locator('button[aria-controls="sf-desktop-filters"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(filters(page)).toBeVisible();
  await expect(radiusField(page)).toBeVisible();
}

test('clearing the flatmates radius does not drop the proximity point', async ({ page }) => {
  await openNear(page, `${POINT}&nearr=12`);
  await expect(radiusField(page)).toHaveValue('12');

  const unscoped = [];
  page.on('request', (r) => {
    if (!/\/flatmates\/feed\?/.test(r.url())) return;
    const p = new URL(r.url()).searchParams;
    if (!p.has('nearLat') || !p.has('nearLng') || !p.has('nearRadiusKm')) unscoped.push(r.url());
  });

  await radiusField(page).fill('');
  await page.waitForTimeout(1500);
  expect(unscoped, 'a search left without the proximity point while the radius field was blank').toEqual([]);

  await radiusField(page).pressSequentially('12');
  await expect(radiusField(page)).toHaveValue('12');
  await radiusField(page).blur();
  await expect(radiusField(page)).toHaveValue('12');
  await expect(filters(page).getByRole('combobox', { name: 'Search a place near you' })).toHaveValue('Baner');
  expect(unscoped, 'a search left without the proximity point').toEqual([]);
});

test('a flatmates radius from outside the controls is clamped to the widest one offered', async ({ page }) => {
  await openNear(page, `${POINT}&nearr=9999`);
  await expect(radiusField(page)).toHaveValue('25');
  await expect(filters(page).getByLabel('Search radius', { exact: true })).toHaveAttribute('max', '25');
});
