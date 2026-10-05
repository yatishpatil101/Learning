import { test, expect } from '@playwright/test';
import { API, signedInAsNew } from '../../helpers/liveAuth.js';

async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch {}
  });
}

async function openFilters(page) {
  const fab = page.locator('.filter-fab');
  await fab.waitFor({ state: 'visible', timeout: 30_000 });
  await fab.click();
  await expect(page.locator('.filter-panel.open')).toBeVisible();
}

const urlPart = (page, key) => new URL(page.url()).searchParams.get(key);

const MAP_DETAIL_SLUG = 'p5150';

async function requireMapDetailFixture() {
  const res = await fetch(`${API}/properties?deal=buy&localities=baner&size=100`);
  expect(res.ok, `GET /properties answered ${res.status}`).toBe(true);
  const rows = (await res.json()).content;
  const picked = rows.find((p) => p.slug === MAP_DETAIL_SLUG);
  expect(picked, `the map detail fixture ${MAP_DETAIL_SLUG} is missing from Baner`).toBeTruthy();
  expect(picked.lat, `${MAP_DETAIL_SLUG} has no coordinates, so it cannot open in the map result set`).toBeTruthy();
  expect(picked.lng).toBeTruthy();
}

test.describe('Listings back-to-close and last-search persistence', () => {
  test('browser Back closes the filter sheet after live filter edits without leaving /listings', async ({ page }) => {
    await withConsent(page);
    await page.goto('/');
    await page.goto('/listings?deal=buy');

    await openFilters(page);
    await page.getByRole('button', { name: 'Budget Range minimum' }).click();
    const minBudget = page.getByRole('textbox', { name: 'Budget Range minimum value' });
    await minBudget.fill('50L');
    await minBudget.press('Enter');
    await expect.poll(() => urlPart(page, 'budget')).toBe('5000000-50000000');

    await page.goBack();
    await expect(page.locator('.filter-panel.open')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/listings');
    await expect.poll(() => urlPart(page, 'budget')).toBe('5000000-50000000');

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });

  test('browser Back closes the map detail panel without leaving /listings or adding a duplicate entry', async ({ page }) => {
    await withConsent(page);
    await requireMapDetailFixture();
    await page.goto('/');
    await page.goto(`/listings?deal=buy&view=map&loc=baner&property=${MAP_DETAIL_SLUG}`);

    await expect(page.locator('.dz-mdp')).toBeVisible();
    expect(urlPart(page, 'property')).toBe(MAP_DETAIL_SLUG);

    await page.goBack();
    await expect(page.locator('.dz-mdp')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/listings');
    expect(urlPart(page, 'view')).toBe('map');
    expect(urlPart(page, 'loc')).toBe('baner');
    expect(urlPart(page, 'property')).toBeNull();

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });

  test('bare /listings restores the last search and logout clears browser search snapshots', async ({ page }) => {
    await withConsent(page);
    await signedInAsNew(page);
    await page.evaluate(() => {
      const snapshot = {
        version: 1,
        filters: { deal: 'rent', localities: ['baner'], rent: [15000, 25000] },
        q: 'metro',
        view: 'list',
        sort: 'price-low',
      };
      localStorage.setItem('draazy.listings.lastSearch.v1', JSON.stringify(snapshot));
      localStorage.setItem('draazy.flatmates.lastSearch.v1', JSON.stringify({ version: 1, filters: { budget: [5000, 15000] } }));
    });

    await page.goto('/listings');
    await expect.poll(() => urlPart(page, 'loc')).toBe('baner');
    expect(urlPart(page, 'rent')).toBe('15000-25000');
    expect(urlPart(page, 'q')).toBe('metro');
    expect(urlPart(page, 'view')).toBe('list');
    expect(urlPart(page, 'sort')).toBe('price-low');

    await page.goto('/');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: /log out/i }).click();

    await expect.poll(() => page.evaluate(() => ({
      listings: localStorage.getItem('draazy.listings.lastSearch.v1'),
      flatmates: localStorage.getItem('draazy.flatmates.lastSearch.v1'),
    }))).toEqual({ listings: null, flatmates: null });
  });
});
