import { test, expect } from '@playwright/test';
import { trackErrors } from '../../helpers/console.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
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
    /* The H1 is name-matched on desktop but only level-matched on mobile: below `sm`
       it renders a shortened title ("Rent in Pune") so the Buy/Rent pill can share its
       row, so /Properties for/i would not match there. */
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/listings?deal=rent`);
    const deskSize = px(
      await page.getByRole('heading', { level: 1, name: /Properties for/i })
        .evaluate((el) => getComputedStyle(el).fontSize)
    );

    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/listings?deal=rent`);
    const mobSize = px(
      await page.getByRole('heading', { level: 1 })
        .evaluate((el) => getComputedStyle(el).fontSize)
    );

    // Heading is text-3xl at every width: desktop 30px; the mobile rule scales it to
    // 1.5rem -> 24px, which is exactly the 20% this suite is named for.
    expect(mobSize).toBeLessThan(deskSize);
    expect(mobSize).toBeCloseTo(24, 0);
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
    // Short title below `sm`, so match by level rather than by name.
    const h1 = page.getByRole('heading', { level: 1 });
    const box = await h1.boundingBox();
    // pt-20 (80px) + navbar clearance; heading top should be comfortably within
    // the first ~200px rather than pushed far down by the old pt-28 band.
    expect(box.y).toBeLessThan(200);
  });

  test('Content is not cluttered/removed: filters + view tiles still present', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/listings?deal=rent`);
    await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
    // Navigation controls intact — the bottom tab bar, now that the top bar's
    // hamburger is gone.
    await expect(page.locator('nav.dz-bottom-nav')).toBeVisible();
  });

  test('No console errors across the optimized consumer pages (mobile)', async ({ page }) => {
    const errors = trackErrors(page);
    await page.setViewportSize(MOBILE);
    for (const p of ['/', '/listings?deal=buy', '/services', '/flatmates']) {
      await page.goto(`${BASE}${p}`);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
