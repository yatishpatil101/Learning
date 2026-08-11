import { test, expect } from '@playwright/test';
import { trackErrors } from '../../helpers/console.js';

/* Admin control for the Google Places geo policy (Settings ▸ Maps).
   Verifies the city-limit toggle and the locality/society blacklist persist to
   settings.geo — the same store lib/geoConfig.js reads to bound every locality
   search across the app. */

const BASE = 'http://localhost:5173';

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

const readGeo = (page) => page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || 'null');
  return db && db.settings ? db.settings.geo || null : null;
});

test.describe('Maps & Places admin control', () => {
  test('city-limit toggle and blacklist persist to settings.geo', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/settings?tab=maps`);

    // Panel renders.
    await expect(page.getByRole('heading', { name: /Restrict Places to the selected city/i })).toBeVisible();
    const cityLimit = page.getByRole('switch', { name: /Restrict Places to selected city/i });
    await expect(cityLimit).toBeVisible();

    // Default policy enforces the city limit.
    await expect(cityLimit).toHaveAttribute('aria-checked', 'true');

    // Add a blacklist term → it shows in the list and persists.
    await page.getByPlaceholder(/name\/term to hide/i).fill('Testville');
    await page.getByPlaceholder('Reason (optional)').fill('QA only');
    await page.getByRole('button', { name: /^Add$/ }).click();

    await expect(page.getByText('Testville', { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const geo = await readGeo(page);
      return geo && Array.isArray(geo.blacklist) ? geo.blacklist.some((b) => b.term === 'Testville') : false;
    }).toBe(true);

    // Turn the city limit off → persists as false.
    await cityLimit.click();
    await expect(cityLimit).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await readGeo(page))?.enforceCityLimit).toBe(false);

    // Remove the blacklist term → gone from list and store.
    await page.getByRole('button', { name: /Remove Testville/i }).click();
    await expect(page.getByRole('button', { name: /Remove Testville/i })).toHaveCount(0);
    await expect.poll(async () => {
      const geo = await readGeo(page);
      return geo && Array.isArray(geo.blacklist) ? geo.blacklist.some((b) => b.term === 'Testville') : false;
    }).toBe(false);
  });

  test('per-city live toggle persists to settings.geo.cities[*].live', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/settings?tab=maps`);

    // Pune ships live by default.
    const puneLive = page.getByRole('switch', { name: /Set Pune live/i });
    await expect(puneLive).toBeVisible();
    await expect(puneLive).toHaveAttribute('aria-checked', 'true');

    // Turning Pune off persists live:false.
    await puneLive.click();
    await expect(puneLive).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await readGeo(page))?.cities?.Pune?.live).toBe(false);

    // Restore Pune to live.
    await puneLive.click();
    await expect.poll(async () => (await readGeo(page))?.cities?.Pune?.live).toBe(true);

    // A "coming soon" city can be promoted to live from the same panel.
    await page.getByRole('button', { name: /Mumbai/ }).first().click();
    const mumbaiLive = page.getByRole('switch', { name: /Set Mumbai live/i });
    await expect(mumbaiLive).toHaveAttribute('aria-checked', 'false');
    await mumbaiLive.click();
    await expect.poll(async () => (await readGeo(page))?.cities?.Mumbai?.live).toBe(true);
  });

  test('boundary editor renders with a fail-soft outline hint under the demo Map ID', async ({ page }) => {
    // The visual boundary editor now highlights a searched place's REAL Google boundary
    // polygon (data-driven styling) — but only with a proper vector Map ID. Under the
    // built-in DEMO_MAP_ID it must degrade gracefully: the rectangle editor still works
    // and a hint tells the operator how to enable the outline. This asserts that fail-soft
    // path (the live-boundary render itself needs a configured Map ID + Google boundary
    // data, which isn't available in test).
    const errors = trackErrors(page);

    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/settings?tab=maps`);

    await expect(page.getByRole('heading', { name: /City coverage/i })).toBeVisible();
    // Fail-soft hint appears because the demo Map ID has no data-driven styling.
    await expect(page.getByText(/set a data-driven/i)).toBeVisible();

    // The panel mounted without throwing (boundary layer setup is best-effort/guarded).
    expect(errors).toEqual([]);
  });
});
