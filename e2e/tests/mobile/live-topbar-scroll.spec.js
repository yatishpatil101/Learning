import { test, expect } from '@playwright/test';

const CONSENT = { necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() };

async function withConsent(page) {
  await page.addInitScript((c) => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify(c));
  }, CONSENT);
}

/** Scroll far enough down, in one direction, to trip the hide threshold. */
async function scrollDown(page, y = 600) {
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForTimeout(400);
}

async function scrollUp(page, y = 400) {
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForTimeout(400);
}

test.describe('Mobile top bar — hide on scroll', () => {
  test.beforeEach(async ({ page }) => {
    await withConsent(page);
  });

  test('the bar is on screen at the top of the page', async ({ page }) => {
    await page.goto('/');
    const bar = page.locator('nav.dz-topbar');
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(box.y).toBeGreaterThan(-1);
  });

  test('scrolling down slides the bar off, scrolling up brings it back', async ({ page }) => {
    await page.goto('/');
    const bar = page.locator('nav.dz-topbar');
    const height = (await bar.boundingBox()).height;

    await scrollDown(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains('dz-nav-hidden'))).toBe(true);
    const hidden = await bar.boundingBox();
    // Fully translated out of the viewport.
    expect(hidden.y + hidden.height).toBeLessThan(1);

    await scrollUp(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains('dz-nav-hidden'))).toBe(false);
    const shown = await bar.boundingBox();
    expect(shown.y).toBeGreaterThan(-1);
    expect(shown.height).toBeCloseTo(height, 0);
  });

  test('returning to the top of the page always restores the bar', async ({ page }) => {
    await page.goto('/');
    await scrollDown(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.classList.contains('dz-nav-hidden'))).toBe(false);
  });

  test('scrolling back up restores the bar and its controls are usable again', async ({ page }) => {
    await page.goto('/');
    await scrollDown(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains('dz-nav-hidden'))).toBe(true);

    // While the bar is away its controls are deliberately unreachable — that is the
    // trade-off hide-on-scroll makes, and the bottom nav carries primary navigation
    // meanwhile. Scrolling up is the recovery gesture.
    await scrollUp(page);
    const signIn = page.locator('nav.dz-topbar').getByRole('link', { name: /^sign in$/i });
    await expect(signIn).toBeVisible();
    await signIn.click();
    await expect(page).toHaveURL(/\/signin/);
  });

  test('the listings sub-header rises to the top edge when the bar hides', async ({ page }) => {
    await page.goto('/listings');
    await page.waitForTimeout(800);
    const sub = page.locator('.dz-docks-under-nav').first();
    if (!(await sub.count()) || !(await sub.isVisible())) test.skip(true, 'sub-header not rendered at this width');

    const before = (await sub.boundingBox()).y;
    await scrollDown(page, 900);
    const after = (await sub.boundingBox()).y;
    // It docks under the bar first, then rises to the screen edge.
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(8);
  });
});
