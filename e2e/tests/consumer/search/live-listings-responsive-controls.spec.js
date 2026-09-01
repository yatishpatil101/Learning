import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

/* The in-page Buy/Rent deal toggle duplicates a journey that already lives in the
   desktop navbar. That navbar collapses below `lg`, so the toggle is the mobile
   stand-in for it — it must only render on mobile/tablet (`lg:hidden`) and stay
   hidden on the web/desktop view.

   The "Looking to share? Browse flatmates & rooms" ticker used to sit beside it and
   is now asserted gone: Flatmates is a permanent slot in the mobile bottom nav, so
   the ticker was a duplicate entry point that pushed results below the fold. */

const dealToggle = (page) => page.getByRole('radiogroup', { name: /Switch between renting and buying/i });
const flatmateTicker = (page) => page.getByRole('link', { name: /Browse flatmates & rooms/i });

test.describe('Listings — mobile-only deal toggle', () => {
  test('Desktop hides the deal toggle', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/listings?deal=rent`);
    await expect(dealToggle(page)).toBeHidden();
  });

  test('Mobile keeps the deal toggle', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/listings?deal=rent`);
    await expect(dealToggle(page)).toBeVisible();
  });

  test('the toggle sits beside the heading on one row, without wrapping it', async ({ page }) => {
    /* It used to be a full-bleed bar stacked under the heading — ~90px of the first
       viewport spent on two words. Beside the heading it costs nothing extra, but only
       if the shortened phone-width title still fits on one line at 360px.

       The header carries `.list-reveal`, which slides it in on load; measuring mid-flight
       reads a stale y. Everything is therefore polled until the animations settle rather
       than sampled once. */
    test.slow(); // two cold /listings loads.
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${BASE}/listings?deal=rent`);
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toBeVisible();
      await expect(dealToggle(page)).toBeVisible();
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

      const boxes = async () => ({ head: await h1.boundingBox(), pill: await dealToggle(page).boundingBox() });
      const { head, pill } = await boxes();

      expect(pill.x, `${width}px: pill sits after the heading`).toBeGreaterThan(head.x + head.width - 1);
      const headMid = head.y + head.height / 2;
      const pillMid = pill.y + pill.height / 2;
      expect(Math.abs(headMid - pillMid), `${width}px: same row`).toBeLessThan(6);
      // One line of a 24px heading; two would push the results further down.
      expect(head.height, `${width}px: heading does not wrap`).toBeLessThan(40);
      // The row must not overflow its container either.
      expect(pill.x + pill.width, `${width}px: row fits the viewport`).toBeLessThanOrEqual(width);

      /* The capsule is drawn at the same height as the sort dropdown and the query
         field below it — three stacked controls at three different heights read as
         sloppy. Its buttons draw under 44px and restore the finger target with
         .tap-extend, so the touch floor is asserted on the pseudo-element's reach
         rather than on the painted box. */
      const sortH = (await page.locator('.dz-dropdown__trigger').first().boundingBox()).height;
      expect(Math.abs(pill.height - sortH), `${width}px: pill matches the sort control`).toBeLessThan(2);
      const tapH = await page.locator('.deal-seg-btn').first().evaluate(
        (el) => parseFloat(getComputedStyle(el, '::before').height)
      );
      expect(tapH, `${width}px: tap target restored by .tap-extend`).toBeGreaterThanOrEqual(44);
    }
  });

  test('the flatmates ticker is gone at both widths', async ({ page }) => {
    // The bottom nav owns Flatmates now; a second link on the Rent tab is redundant.
    test.slow(); // two cold /listings loads in one test.
    for (const size of [MOBILE, DESKTOP]) {
      await page.setViewportSize(size);
      await page.goto(`${BASE}/listings?deal=rent`);
      await expect(flatmateTicker(page), `${size.width}px should mount no ticker`).toHaveCount(0);
    }
  });
});
