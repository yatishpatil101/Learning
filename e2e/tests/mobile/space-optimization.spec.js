import { test, expect } from '@playwright/test';
import { trackErrors } from '../../helpers/console.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const px = (s) => parseFloat(s);


test.describe('Mobile space optimization', () => {
  test('consumer headings shrink on mobile, sit higher, leave desktop untouched and log no errors', async ({ page }) => {
    test.slow();

    await test.step('Listings H1 is 20% smaller on mobile than desktop, which stays unchanged', async () => {
      /* Below `sm` the H1 renders a shortened title ("Rent in Pune") so the Buy/Rent pill can share its
         row, so mobile matches by level instead of /Properties for/i. */
      await page.setViewportSize(DESKTOP);
      await page.goto(`${BASE}/listings?deal=rent`);
      const deskSize = px(
        await page.getByRole('heading', { level: 1, name: /Properties for/i })
          .evaluate((el) => getComputedStyle(el).fontSize)
      );
      // sm:text-3xl -> 30px, untouched by the mobile-only rule.
      expect(deskSize).toBeCloseTo(30, 0);

      await page.setViewportSize(MOBILE);
      await page.goto(`${BASE}/listings?deal=rent`);
      const h1 = page.getByRole('heading', { level: 1 });
      const mobSize = px(await h1.evaluate((el) => getComputedStyle(el).fontSize));

      // Heading is text-3xl at every width: desktop 30px; the mobile rule scales it to
      // 1.5rem -> 24px, which is exactly the 20% this suite is named for.
      expect(mobSize).toBeLessThan(deskSize);
      expect(mobSize).toBeCloseTo(24, 0);

      // pt-20 (80px) + navbar clearance; heading top should be comfortably within
      // the first ~200px rather than pushed far down by the old pt-28 band.
      const box = await h1.boundingBox();
      expect(box.y).toBeLessThan(200);
    });

    const errors = trackErrors(page);

    await test.step('Home hero H1 shrinks on mobile and applies the tightened leading', async () => {
      await page.goto(`${BASE}/`);
      const h1 = page.getByRole('heading', { level: 1 }).first();
      const size = px(await h1.evaluate((el) => getComputedStyle(el).fontSize));
      // text-4xl (36px) -> 1.8rem = 28.8px on mobile.
      expect(size).toBeCloseTo(28.8, 0);
      const lh = px(await h1.evaluate((el) => getComputedStyle(el).lineHeight));
      // line-height:1.15 of 28.8px ~= 33.1px (well under the default leading-tight).
      expect(lh).toBeLessThan(size * 1.25);
    });

    await test.step('No console errors across the optimized consumer pages (mobile)', async () => {
      for (const p of ['/listings?deal=buy', '/services', '/flatmates']) {
        await page.goto(`${BASE}${p}`);
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
});
