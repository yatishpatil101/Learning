import { test, expect } from '../../fixtures/live.js';
import { trackErrors } from '../../helpers/console.js';

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

/* Assert an element is fully within the viewport horizontally (not clipped off the
   right edge — the bug the redesign fixes). */
async function inViewportX(locator, viewportWidth) {
  const box = await locator.boundingBox();
  expect(box, 'element should be rendered').not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 0.5);
}

test.describe('Mobile navbar — context-aware left slot', () => {
  test('the phone top bar picks its left slot by context, keeps the account pill in view and logs no errors', async ({ page, login }) => {
    test.slow();
    await login.asBuyer();
    const errors = trackErrors(page);
    await page.setViewportSize(MOBILE);

    await test.step('Home (mobile) shows the city pill', async () => {
      await page.goto(`/`);
      await expect(page.getByRole('button', { name: /City: Pune/i })).toBeVisible();
    });

    await test.step('The Buy/Rent segmented toggle is gone everywhere', async () => {
      await page.goto(`/listings?deal=rent`);
      await expect(page.getByRole('group', { name: 'Listing type' })).toHaveCount(0);
      // City pill is still hidden on listings (mobile).
      await expect(page.getByRole('button', { name: /City: Pune/i })).toBeHidden();
    });

    await test.step('Non-home pages show a compact icon-only Back button (no page-name pill)', async () => {
      // Flatmates must NOT show a redundant "Flatmates" pill.
      await page.goto(`/flatmates`);
      const back = page.getByRole('button', { name: /Go back/i });
      await expect(back).toBeVisible();
      await expect(back).not.toContainText(/Flatmates/i);
      await expect(page.getByRole('button', { name: /Back to/i })).toHaveCount(0);
    });

    await test.step('Account pill stays visible (in viewport) on every page', async () => {
      for (const path of ['/', '/listings?deal=rent', '/services', '/flatmates']) {
        await page.goto(path);
        // The account pill is the top bar's only trailing control; the bottom tab bar owns navigation.
        const account = page.getByRole('button', { name: /Account menu/i });
        await expect(page.getByRole('button', { name: /Toggle menu/i })).toHaveCount(0);
        await expect(account).toBeVisible();
        await inViewportX(account, MOBILE.width);
      }
    });

    await test.step('Back button navigates to the previous in-app page', async () => {
      await page.goto(`/`);
      await page.goto(`/services`);
      await page.getByRole('button', { name: /Go back/i }).click();
      await expect(page).toHaveURL(`/`);
    });

    await test.step('No console errors while navigating the redesigned navbar', async () => {
      await page.goto(`/listings?deal=buy`);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    /* Seven top-bar targets across 360px put the account pill on the right edge. Compare has another home, so
       below `lg` it moves to the account drawer; assert the count and that its route stays reachable. */
    await test.step('the signed-in phone top bar sheds Compare to the account drawer', async () => {
      await page.setViewportSize({ width: 360, height: 640 });
      await page.goto(`/listings?deal=rent`);

      const row = page.locator('.dz-topbar__row');
      await expect(row.locator('a:visible, button:visible')).toHaveCount(6);
      await expect(row.locator('a[href="/compare"]')).toBeHidden();

      // Still reachable, one tap deeper.
      await page.getByRole('button', { name: /Account menu/i }).click();
      const drawerCompare = page.locator('a[href="/compare"]:visible');
      await expect(drawerCompare).toHaveCount(1);
      await drawerCompare.click();
      await expect(page).toHaveURL(/\/compare/);
    });
  });

  test('Desktop keeps the city pill on non-home pages and shows no back button', async ({ page, login }) => {
    await login.asBuyer();
    await page.setViewportSize(DESKTOP);
    await page.goto(`/services`);
    await expect(page.getByRole('button', { name: /City: Pune/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Go back/i })).toBeHidden();
  });
});
