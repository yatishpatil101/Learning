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
  test('Home (mobile) shows the city pill', async ({ page, login }) => {
    await login.asBuyer();
    await page.setViewportSize(MOBILE);
    await page.goto(`/`);
    await expect(page.getByRole('button', { name: /City: Pune/i })).toBeVisible();
  });

  test('The Buy/Rent segmented toggle is gone everywhere', async ({ page, login }) => {
    await login.asBuyer();
    await page.setViewportSize(MOBILE);
    await page.goto(`/listings?deal=rent`);
    await expect(page.getByRole('group', { name: 'Listing type' })).toHaveCount(0);
    // City pill is still hidden on listings (mobile).
    await expect(page.getByRole('button', { name: /City: Pune/i })).toBeHidden();
  });

  test('Non-home pages show a compact icon-only Back button (no page-name pill)', async ({ page, login }) => {
    await login.asBuyer();
    await page.setViewportSize(MOBILE);
    // Flatmates must NOT show a redundant "Flatmates" pill.
    await page.goto(`/flatmates`);
    const back = page.getByRole('button', { name: /Go back/i });
    await expect(back).toBeVisible();
    await expect(back).not.toContainText(/Flatmates/i);
    await expect(page.getByRole('button', { name: /Back to/i })).toHaveCount(0);
  });

  test('Account pill stays visible (in viewport) on every page', async ({ page, login }) => {
    await login.asBuyer();
    await page.setViewportSize(MOBILE);
    for (const path of ['/', '/listings?deal=rent', '/services', '/flatmates']) {
      await page.goto(path);
      // The hamburger that used to sit beside it is gone — the bottom tab bar owns
      // navigation now — so the account pill is the top bar's only trailing control.
      const account = page.getByRole('button', { name: /Account menu/i });
      await expect(page.getByRole('button', { name: /Toggle menu/i })).toHaveCount(0);
      await expect(account).toBeVisible();
      await inViewportX(account, MOBILE.width);
    }
  });

  /* D98b: signed in on /listings the phone top bar carried seven targets across 360px,
     with the account pill landing exactly on the right edge. Compare is the only one of
     the seven whose destination has somewhere else to live, so below `lg` it moves into
     the account drawer. The count is the point of the test — anything re-added inline
     puts the pill back on the edge — and so is the reachability check under it: a route
     must not lose its only mobile entry point to a density fix. */
  test('the signed-in phone top bar sheds Compare to the account drawer', async ({ page, login }) => {
    await login.asBuyer();
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

  test('Back button navigates to the previous in-app page', async ({ page, login }) => {    await login.asBuyer();
    await page.setViewportSize(MOBILE);
    await page.goto(`/`);
    await page.goto(`/services`);
    await page.getByRole('button', { name: /Go back/i }).click();
    await expect(page).toHaveURL(`/`);
  });

  test('Desktop keeps the city pill on non-home pages and shows no back button', async ({ page, login }) => {
    await login.asBuyer();
    await page.setViewportSize(DESKTOP);
    await page.goto(`/services`);
    await expect(page.getByRole('button', { name: /City: Pune/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Go back/i })).toBeHidden();
  });

  test('No console errors while navigating the redesigned navbar', async ({ page, login }) => {
    await login.asBuyer();
    const errors = trackErrors(page);
    await page.setViewportSize(MOBILE);
    await page.goto(`/`);
    await page.goto(`/listings?deal=buy`);
    await page.goto(`/services`);
    await page.goto(`/flatmates`);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
