import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const USER = { name: 'Aisha Khan', mobile: '9876500011', role: 'buyer' };

/* Seed a signed-in session so the account pill renders (it only shows when logged in). */
async function signedIn(page) {
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
  }, USER);
}

/* Assert an element is fully within the viewport horizontally (not clipped off the
   right edge — the bug the redesign fixes). */
async function inViewportX(locator, viewportWidth) {
  const box = await locator.boundingBox();
  expect(box, 'element should be rendered').not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 0.5);
}

test.describe('Mobile navbar — context-aware left slot', () => {
  test('Home (mobile) shows the city pill', async ({ page }) => {
    await signedIn(page);
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/`);
    await expect(page.getByRole('button', { name: /City: Pune/i })).toBeVisible();
  });

  test('The Buy/Rent segmented toggle is gone everywhere', async ({ page }) => {
    await signedIn(page);
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/listings?deal=rent`);
    await expect(page.getByRole('group', { name: 'Listing type' })).toHaveCount(0);
    // City pill is still hidden on listings (mobile).
    await expect(page.getByRole('button', { name: /City: Pune/i })).toBeHidden();
  });

  test('Non-home pages show a compact icon-only Back button (no page-name pill)', async ({ page }) => {
    await signedIn(page);
    await page.setViewportSize(MOBILE);
    // Share-a-Flat must NOT show a redundant "Share a Flat" pill.
    await page.goto(`${BASE}/share-flat`);
    const back = page.getByRole('button', { name: /Go back/i });
    await expect(back).toBeVisible();
    await expect(back).not.toContainText(/Share a Flat/i);
    await expect(page.getByRole('button', { name: /Back to/i })).toHaveCount(0);
  });

  test('Account pill AND hamburger stay visible (in viewport) on every page', async ({ page }) => {
    await signedIn(page);
    await page.setViewportSize(MOBILE);
    for (const path of ['/', '/listings?deal=rent', '/services', '/share-flat']) {
      await page.goto(`${BASE}${path}`);
      const hamburger = page.getByRole('button', { name: /Toggle menu/i });
      const account = page.getByRole('button', { name: /Account menu/i });
      await expect(hamburger).toBeVisible();
      await expect(account).toBeVisible();
      await inViewportX(hamburger, MOBILE.width);
      await inViewportX(account, MOBILE.width);
    }
  });

  test('Back button navigates to the previous in-app page', async ({ page }) => {
    await signedIn(page);
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/`);
    await page.goto(`${BASE}/services`);
    await page.getByRole('button', { name: /Go back/i }).click();
    await expect(page).toHaveURL(`${BASE}/`);
  });

  test('Desktop keeps the city pill on non-home pages and shows no back button', async ({ page }) => {
    await signedIn(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/services`);
    await expect(page.getByRole('button', { name: /City: Pune/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Go back/i })).toBeHidden();
  });

  test('No console errors while navigating the redesigned navbar', async ({ page }) => {
    await signedIn(page);
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const t = msg.text();
      if (/favicon|leaflet|net::ERR|Failed to load resource|tile\./i.test(t)) return;
      errors.push(t);
    });
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/`);
    await page.goto(`${BASE}/listings?deal=buy`);
    await page.goto(`${BASE}/services`);
    await page.goto(`${BASE}/share-flat`);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
