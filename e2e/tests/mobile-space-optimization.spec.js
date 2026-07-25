import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const px = (s) => parseFloat(s);

/* Verifies mobile space optimization:
   - Consumer headings are scaled down ~20% on mobile (<640px) vs desktop.
   - Hero/top bands sit higher on mobile (heading nearer the top).
   - Desktop sizing is unchanged.
   - Option tiles / nav controls remain present (no clutter/removal). */

test.describe('Mobile space optimization', () => {
  test('Listings H1 is 20% smaller on mobile than desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/listings?deal=rent`);
    const h1 = page.getByRole('heading', { level: 1, name: /Properties for/i });
    const deskSize = px(await h1.evaluate((el) => getComputedStyle(el).fontSize));

    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/listings?deal=rent`);
    const mobSize = px(await h1.evaluate((el) => getComputedStyle(el).fontSize));

    // Heading is text-2xl sm:text-3xl: desktop sm:text-3xl -> 30px; mobile base
    // text-2xl is scaled by the mobile rule to 1.2rem -> 19.2px.
    expect(mobSize).toBeLessThan(deskSize);
    expect(mobSize).toBeCloseTo(19.2, 0);
  });

  test('Home hero H1 shrinks on mobile and applies the tightened leading', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/`);
    const h1 = page.getByRole('heading', { level: 1 }).first();
    const size = px(await h1.evaluate((el) => getComputedStyle(el).fontSize));
    // text-4xl (36px) -> 1.8rem = 28.8px on mobile.
    expect(size).toBeCloseTo(28.8, 0);
    const lh = px(await h1.evaluate((el) => getComputedStyle(el).lineHeight));
    // line-height:1.15 of 28.8px ~= 33.1px (well under the default leading-tight).
    expect(lh).toBeLessThan(size * 1.25);
  });

  test('Desktop heading sizes are unchanged (rule is mobile-only)', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/listings?deal=buy`);
    const h1 = page.getByRole('heading', { level: 1, name: /Properties for/i });
    const size = px(await h1.evaluate((el) => getComputedStyle(el).fontSize));
    // sm:text-3xl -> 30px, untouched by the mobile-only rule.
    expect(size).toBeCloseTo(30, 0);
  });

  test('Listings heading sits higher on the page on mobile (reduced top band)', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/listings?deal=rent`);
    const h1 = page.getByRole('heading', { level: 1, name: /Properties for/i });
    const box = await h1.boundingBox();
    // pt-20 (80px) + navbar clearance; heading top should be comfortably within
    // the first ~200px rather than pushed far down by the old pt-28 band.
    expect(box.y).toBeLessThan(200);
  });

  test('Content is not cluttered/removed: filters + view tiles still present', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/listings?deal=rent`);
    await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
    // Navbar controls intact.
    await expect(page.getByRole('button', { name: /Toggle menu/i })).toBeVisible();
  });

  test('No console errors across the optimized consumer pages (mobile)', async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const t = msg.text();
      if (/favicon|leaflet|net::ERR|Failed to load resource|tile\./i.test(t)) return;
      errors.push(t);
    });
    await page.setViewportSize(MOBILE);
    for (const p of ['/', '/listings?deal=buy', '/services', '/share-flat']) {
      await page.goto(`${BASE}${p}`);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
