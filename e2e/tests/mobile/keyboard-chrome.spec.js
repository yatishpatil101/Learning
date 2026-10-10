import { test, expect } from '../../fixtures/live.js';

/* Playwright cannot raise a soft keyboard; shrinking the viewport while a field has focus is what the browser reports
   when one opens, so that is the proxy. */
const KEYBOARD_PX = 300;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
  });
});

test('the bottom nav gets out of the way while a text field has the keyboard, and returns when it closes', async ({ page }) => {
  await page.goto('/listings');
  const nav = page.locator('nav.dz-bottom-nav');
  await expect(nav).toBeVisible();
  const { width, height } = page.viewportSize();

  await page.getByRole('textbox', { name: 'Smart search' }).focus();
  await page.setViewportSize({ width, height: height - KEYBOARD_PX });
  await expect(page.locator('html')).toHaveClass(/dz-kbd-open/);
  await expect(nav, 'the nav would otherwise sit on top of the keyboard').toBeHidden();

  await page.setViewportSize({ width, height });
  await expect(page.locator('html')).not.toHaveClass(/dz-kbd-open/);
  await expect(nav).toBeVisible();
});

test('a shorter viewport with nothing being typed into is not a keyboard', async ({ page }) => {
  await page.goto('/listings');
  const { width, height } = page.viewportSize();
  await page.setViewportSize({ width, height: height - KEYBOARD_PX });
  await expect(page.locator('nav.dz-bottom-nav')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/dz-kbd-open/);
});
