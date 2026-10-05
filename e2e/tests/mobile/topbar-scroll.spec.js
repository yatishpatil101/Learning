import { test, expect } from '@playwright/test';

const CONSENT = { necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() };

async function withConsent(page) {
  await page.addInitScript((c) => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify(c));
  }, CONSENT);
}

async function scrollDown(page, y = 600) {
  await page.waitForFunction(
    (to) => document.documentElement.scrollHeight > window.innerHeight + Math.min(to, 200),
    y,
  );
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForFunction(() => window.scrollY > 0);
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

  test('the bar hides on scroll down, returns on scroll up or at the top, and stays usable', async ({ page }) => {
    await page.goto('/');
    const bar = page.locator('nav.dz-topbar');
    await expect(bar).toBeVisible();
    const top = await bar.boundingBox();
    expect(top.y).toBeGreaterThan(-1);
    const height = top.height;
    const navHidden = () => page.evaluate(() => document.documentElement.classList.contains('dz-nav-hidden'));

    await test.step('scrolling down slides the bar off, scrolling up brings it back', async () => {
      await scrollDown(page);
      expect(await navHidden()).toBe(true);
      const hidden = await bar.boundingBox();
      // Fully translated out of the viewport.
      expect(hidden.y + hidden.height).toBeLessThan(1);

      // Hidden topbar controls are acceptable because bottom nav carries primary navigation.
      await scrollUp(page);
      expect(await navHidden()).toBe(false);
      const shown = await bar.boundingBox();
      expect(shown.y).toBeGreaterThan(-1);
      expect(shown.height).toBeCloseTo(height, 0);
    });

    await test.step('returning to the top of the page always restores the bar', async () => {
      await scrollDown(page);
      expect(await navHidden()).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      expect(await navHidden()).toBe(false);
    });

    await test.step('its controls are usable again after scrolling back up', async () => {
      await scrollDown(page);
      expect(await navHidden()).toBe(true);
      await scrollUp(page);
      const signIn = bar.getByRole('link', { name: /^sign in$/i });
      await expect(signIn).toBeVisible();
      await signIn.click();
      await expect(page).toHaveURL(/\/signin/);
    });
  });

  test('the listings sub-header rises to the top edge when the bar hides', async ({ page }) => {
    await page.goto('/listings');
    const sub = page.locator('.dz-docks-under-nav').first();
    await expect(sub).toBeVisible();

    const before = (await sub.boundingBox()).y;
    await scrollDown(page, 900);
    const after = (await sub.boundingBox()).y;
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(8);
  });
});
