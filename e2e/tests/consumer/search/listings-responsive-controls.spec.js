import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const DESKTOP = { width: 1280, height: 900 };

/* The in-page Buy/Rent toggle stands in for the navbar one that collapses below `lg`, so it renders only below lg;
   the flatmates ticker stays gone because Flatmates already has a permanent bottom-nav slot. */

const dealToggle = (page) => page.getByRole('radiogroup', { name: /Switch between renting and buying/i });
const flatmateTicker = (page) => page.getByRole('link', { name: /Browse flatmates & rooms/i });

test.describe('Listings — mobile-only deal toggle', () => {
  test('the toggle is hidden on desktop and sits beside the heading on one row on mobile, without wrapping it', async ({ page }) => {
    /* The header's .list-reveal slide-in makes a single sample read a stale y, so poll until animations settle. */
    test.slow(); // three cold /listings loads.

    await test.step('Desktop hides the deal toggle and mounts no flatmates ticker', async () => {
      await page.setViewportSize(DESKTOP);
      await page.goto(`${BASE}/listings?deal=rent`);
      await expect(dealToggle(page)).toBeHidden();
      // The bottom nav owns Flatmates now; a second link on the Rent tab is redundant.
      await expect(flatmateTicker(page), `${DESKTOP.width}px should mount no ticker`).toHaveCount(0);
    });

    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${BASE}/listings?deal=rent`);
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toBeVisible();
      await expect(dealToggle(page)).toBeVisible();
      await expect(flatmateTicker(page), `${width}px should mount no ticker`).toHaveCount(0);
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

      /* Same height as the sort dropdown and query field below. Buttons paint under 44px and .tap-extend
         restores the target, so the touch floor is asserted on the pseudo-element's reach. */
      const sortH = (await page.locator('.dz-dropdown__trigger').first().boundingBox()).height;
      expect(Math.abs(pill.height - sortH), `${width}px: pill matches the sort control`).toBeLessThan(2);
      const tapH = await page.locator('.deal-seg-btn').first().evaluate(
        (el) => parseFloat(getComputedStyle(el, '::before').height)
      );
      expect(tapH, `${width}px: tap target restored by .tap-extend`).toBeGreaterThanOrEqual(44);
    }
  });
});
