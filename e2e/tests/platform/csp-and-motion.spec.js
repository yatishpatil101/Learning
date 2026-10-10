import { test, expect } from '../../fixtures/live.js';

test.describe('Pre-paint theme script under a hash-only CSP', () => {
  test('the theme is light by default, a dark choice survives a reload, and neither trips the CSP', async ({ page }) => {
    const violations = [];
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });

    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\blight\b/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f3f7f6');

    await page.evaluate(() => localStorage.setItem('dzAppPrefs', JSON.stringify({ theme: 'dark', reduceMotion: false })));
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/\blight\b/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f0d1a');
    expect(await page.evaluate(() => window.__cspViolations), 'no inline script was blocked').toEqual([]);
    expect(violations).toEqual([]);
  });
});

test.describe('Reduced motion', () => {
  const scrolledInstantly = (page) => page.evaluate(() => {
    window.scrollTo({ top: 300, behavior: 'smooth' });
    return window.scrollY === 300;
  });

  test('scripted smooth scrolling is instant when the OS asks for less motion, and stays smooth otherwise', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    expect(await scrolledInstantly(page), 'smooth by default').toBe(false);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await scrolledInstantly(page), 'instant under prefers-reduced-motion').toBe(true);
  });

  test('the in-app Reduce motion toggle is honoured too', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('dzAppPrefs', JSON.stringify({ reduceMotion: true, theme: 'dark' })));
    await page.goto('/');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    expect(await scrolledInstantly(page)).toBe(true);
  });
});
