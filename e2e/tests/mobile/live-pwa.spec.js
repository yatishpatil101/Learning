import { test, expect } from '@playwright/test';

/* PWA installability (review §F #17).

   Scope note: these run against the *dev* server, where `devOptions.enabled: false`
   deliberately keeps the service worker switched off — a worker in dev would serve stale
   chunks after an edit and would make this whole suite nondeterministic. So the caching
   behaviour is NOT asserted here. What is asserted is everything that decides whether the
   app can be installed at all, which is where a silent break is actually likely: someone
   deletes an icon, or renames the manifest, and nobody notices until a user tries to add
   the app to their home screen.

   The service worker's runtime behaviour (app shell offline, /api/* never cached) is
   verified against a production build via `npm run build && npm run preview` — see the
   PWA section of tasks/todo.md for the measured results. */

test.describe('PWA installability', () => {
  test('index.html links a manifest and declares the mobile chrome colours', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    // theme-color tints the Android status bar in standalone mode; without it an
    // installed app shows a white band above a dark UI.
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f0d1a');
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('viewport-fit=cover');
  });

  test('the manifest is valid and has the fields an install prompt requires', async ({ page, baseURL }) => {
    const res = await page.request.get(new URL('/manifest.webmanifest', baseURL).href);
    expect(res.status()).toBe(200);

    const m = await res.json();
    expect(m.name).toBeTruthy();
    // Android home screens truncate past ~12 chars; a long short_name is silently cut.
    expect(m.short_name.length).toBeLessThanOrEqual(12);
    expect(m.start_url).toBeTruthy();
    expect(m.scope).toBe('/');
    // 'standalone' is what removes the browser chrome — the whole point of installing.
    expect(m.display).toBe('standalone');
  });

  test('orientation is not locked to portrait', async ({ page, baseURL }) => {
    const m = await (await page.request.get(new URL('/manifest.webmanifest', baseURL).href)).json();
    // A portrait lock would mean the landscape layout work (shorter navbar, icon-only
    // 44px tab bar) could never run for installed users — the CSS would be dead code
    // for exactly the audience the PWA is aimed at. See mobile-landscape.spec.js.
    expect(m.orientation).not.toBe('portrait');
    expect(m.orientation).not.toBe('portrait-primary');
  });

  test('every declared icon actually exists, including a maskable one', async ({ page, baseURL }) => {
    const m = await (await page.request.get(new URL('/manifest.webmanifest', baseURL).href)).json();

    // Chrome requires a 192px and a 512px icon before it will offer installation.
    const sizes = m.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');

    // Without a maskable icon Android letterboxes the logo inside a white circle,
    // which looks broken next to native apps.
    expect(m.icons.some((i) => (i.purpose || '').includes('maskable'))).toBe(true);

    for (const icon of m.icons) {
      const r = await page.request.get(new URL(icon.src, baseURL).href);
      expect(r.status(), `icon missing: ${icon.src}`).toBe(200);
      expect(Number(r.headers()['content-length'] || 1)).toBeGreaterThan(0);
    }
  });

  test('no service worker is active in dev, so the suite stays deterministic', async ({ page }) => {
    await page.goto('/');
    const state = await page.evaluate(async () => ({
      regs: (await navigator.serviceWorker.getRegistrations()).length,
      controlled: !!navigator.serviceWorker.controller,
    }));
    // If this ever fails, devOptions.enabled has been turned on and every other spec in
    // this repo just became susceptible to stale-cache flakes.
    expect(state.regs).toBe(0);
    expect(state.controlled).toBe(false);
  });
});
