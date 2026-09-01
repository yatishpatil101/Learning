import { test, expect } from '@playwright/test';

/* Flatmates map focus gate (mirrors the Listings map gate) + the precise
   "Near a Place" radius filter that per-post coordinates now make possible.

   The aggregated bubble map is calmest once the seeker focuses on a few areas, so
   Map view opens on a "Focus your map" picker; picking one area unlocks the map.
   A proximity deep-link (?near=lat,lng&nearr=km) self-focuses the map and narrows
   the list to posts within the radius — deterministic, no live Places needed. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('map view opens on the focus gate, not the bubble map', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByRole('heading', { name: /Focus your map/i })).toBeVisible();
  await expect(page.locator('.map-pin')).toHaveCount(0);
});

test('picking a focus area unlocks the bubble map', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.getByRole('button', { name: 'Map' }).click();
  await page.locator('[data-sf-area]').first().waitFor({ timeout: 20000 });
  await page.locator('[data-sf-area]').first().click();
  await expect(page.locator('.map-pin').first()).toBeVisible({ timeout: 20000 });
});

test('switching tabs re-gates the map', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.getByRole('button', { name: 'Map' }).click();
  await page.locator('[data-sf-area]').first().waitFor({ timeout: 20000 });
  await page.locator('[data-sf-area]').first().click();
  await expect(page.locator('.map-pin').first()).toBeVisible({ timeout: 20000 });

  // Still in map view, but a new tab starts unfocused — the gate returns.
  await page.getByRole('button', { name: /Team up/i }).first().click();
  await expect(page.getByRole('heading', { name: /Focus your map/i })).toBeVisible();
  await expect(page.locator('.map-pin')).toHaveCount(0);
});

test('a Near-a-Place radius deep link narrows the list to nearby posts', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  const before = await page.locator('.sf-card').count();

  // Baner centroid, 5 km — keeps only flatmates whose primary area sits nearby.
  await page.goto(`${BASE}/flatmates?view=flatmates&near=18.559,73.776&nearlabel=Baner&nearr=5`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  const after = await page.locator('.sf-card').count();

  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
});

test('a proximity deep link self-focuses the map (no gate)', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates&near=18.559,73.776&nearlabel=Baner&nearr=5`);
  await page.getByRole('button', { name: 'Map' }).click();
  // Near is set, so the map opens straight to bubbles — no focus gate.
  await expect(page.locator('.map-pin').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: /Focus your map/i })).toHaveCount(0);
});
