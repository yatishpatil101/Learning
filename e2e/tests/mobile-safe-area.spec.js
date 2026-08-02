import { test, expect } from '@playwright/test';

/* PWA / safe-area baseline.

   Without viewport-fit=cover every env(safe-area-inset-*) in the stylesheet silently
   resolves to 0, so the three rules that already handled insets were dead code and
   fixed bottom bars sat under the gesture bar. These assertions are the tripwire. */

test.describe('Mobile safe area + PWA baseline', () => {
  test('viewport meta opts into the display cutout', async ({ page }) => {
    await page.goto('/');
    const content = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(content).toContain('width=device-width');
    expect(content).toContain('viewport-fit=cover');
  });

  test('theme-color and manifest are declared', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f0d1a');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  });

  test('the manifest is served and installable-shaped', async ({ page, request }) => {
    await page.goto('/');
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBeTruthy();
    const m = await res.json();
    expect(m.display).toBe('standalone');
    expect(m.start_url).toContain('/');
    expect(m.theme_color).toBe('#0f0d1a');
    // 192 + 512 are the install-prompt minimum; maskable keeps the Android icon from
    // being letterboxed inside the adaptive-icon mask.
    const sizes = m.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBeTruthy();
    for (const icon of m.icons) {
      const iconRes = await request.get(icon.src);
      expect(iconRes.ok(), `${icon.src} should be served`).toBeTruthy();
    }
  });

  test('the safe-area custom properties are defined', async ({ page }) => {
    await page.goto('/');
    const vars = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        safeB: s.getPropertyValue('--pn-safe-b').trim(),
        navH: s.getPropertyValue('--pn-bottom-nav-h').trim(),
      };
    });
    // Headless Chromium reports a 0px inset, which is exactly what a device without a
    // gesture bar reports — the point is that the property resolves at all.
    expect(vars.safeB).toBe('0px');
    expect(vars.navH).toBe('56px');
  });
});
