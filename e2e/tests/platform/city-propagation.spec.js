import { test, expect } from '@playwright/test';
import { appReady } from '../../helpers/app.js';

/* City selection must propagate across the app. Pune has inventory + a locality registry;
   other cities can be toggled live in admin but have no data yet, so they must show an
   honest city-aware presentation (dynamic copy + "just launched" empty state) and never
   leak Pune localities or listings. */

const BASE = 'http://localhost:5173';

// Force the active city and mark it live in the mock DB, then reload so CityContext picks it up.
// `appReady` first: every caller reaches this straight off a `goto`, and the store is written
// one microtask past the point any navigation wait resolves (D129).
async function selectCity(page, city) {
  await appReady(page);
  await page.evaluate((c) => {
    localStorage.setItem('puneNestCity', c);
    // No `|| '{}'`. This is a read-modify-write: an empty fallback is written straight back,
    // wiping every listing, society and setting, and the damage only surfaces later as a
    // blank page nobody connects to this line.
    const raw = localStorage.getItem('puneNestDB_v5');
    if (!raw) throw new Error('mock store missing after appReady()');
    const db = JSON.parse(raw);
    db.settings = db.settings || {};
    db.settings.geo = db.settings.geo || {};
    db.settings.geo.cities = db.settings.geo.cities || {};
    db.settings.geo.cities[c] = { ...(db.settings.geo.cities[c] || {}), live: true };
    localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
  }, city);
  await page.reload();
}

test('Pune (has inventory) shows the full home experience', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');
  await expect(page.getByRole('button', { name: 'Baner', exact: true })).toBeVisible();
});

test('Mumbai (live, no inventory) shows an honest city-aware home — no Pune content', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await selectCity(page, 'Mumbai');

  // Hero copy reflects the selected city.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mumbai');
  await expect(page.locator('p.hero-sub')).toContainText(/just launched in/i);
  await expect(page.locator('p.hero-sub')).toContainText('Mumbai');

  // Honest empty state instead of Pune content.
  await expect(page.getByRole('button', { name: /List your property/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Baner', exact: true })).toHaveCount(0);
});

test('Mumbai listings show an honest empty state, not Pune listings', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await selectCity(page, 'Mumbai');
  await page.goto(`${BASE}/listings?deal=buy`);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mumbai');
  await expect(page.getByRole('heading', { name: /No listings in Mumbai yet/i })).toBeVisible();
  // No Pune property cards leak through.
  await expect(page.locator('a[href^="/property/"]')).toHaveCount(0);
});

test('switching back to Pune restores inventory', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await selectCity(page, 'Mumbai');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mumbai');
  await selectCity(page, 'Pune');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');
  await expect(page.getByRole('button', { name: 'Baner', exact: true })).toBeVisible();
});

test('admin taking the viewed city offline reverts the shopper to Pune (no manual reload)', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await selectCity(page, 'Mumbai');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mumbai');

  // Simulate the admin toggling Mumbai off in the shared geo store, exactly like
  // updateSettings/syncGeoFromDisk do: flip live -> false, then fire the in-tab event.
  await page.evaluate(() => {
    const raw = localStorage.getItem('puneNestDB_v5');
    if (!raw) throw new Error('mock store missing'); // read-modify-write: never fall back to {}
    const db = JSON.parse(raw);
    db.settings.geo.cities.Mumbai = { ...(db.settings.geo.cities.Mumbai || {}), live: false };
    localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
    window.dispatchEvent(new CustomEvent('punenest-settings-change'));
  });

  // The shopper is kicked back to the default live city with no page reload.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');
  await expect(page.getByRole('button', { name: 'Baner', exact: true })).toBeVisible();
  await expect(await page.evaluate(() => localStorage.getItem('puneNestCity'))).toBe('Pune');
});

test('picking a "coming soon" city and cancelling leaves the shopper on their city', async ({ page }) => {
  await page.goto(`${BASE}/`);
  const pill = page.getByRole('button', { name: /^City: / }).first();
  await pill.click();
  await page.getByRole('listbox', { name: 'Select city' }).getByRole('button', { name: /Mumbai/ }).click();

  // A coming-soon city is a waitlist prompt, not a destination.
  const modal = page.getByRole('heading', { name: /Join the Mumbai waitlist/i });
  await expect(modal).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Cancel is a true no-op: no city switch, no waitlist banner, nothing persisted.
  await expect(modal).toHaveCount(0);
  await expect(pill).toHaveAttribute('aria-label', 'City: Pune');
  await expect(page.getByText(/isn't live in/i)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');
  expect(await page.evaluate(() => localStorage.getItem('puneNestCity'))).not.toBe('Mumbai');
});
