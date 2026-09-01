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

  /* F5 — no two pieces of fixed chrome may occupy the same pixels.

     This is the defect class that produced the autosave toast painting on top of
     the mobile tab bar (band [590..624] against a nav at [572..628]) and the
     assistant coach-mark sitting over the listing price. Both were invisible in
     review and obvious on a phone, and both are *stacking* bugs rather than
     styling ones — which is why the z-index ladder is documented in index.css.

     Stacking ADJACENTLY is fine and intended: a sticky page CTA sits directly
     above the tab bar. What is never fine is two layers sharing pixels, because
     one of them is then unreachable.

     Only the resting state of each route is checked. An open sheet or modal is
     *supposed* to cover the chrome, so anything under a dialog/backdrop is
     skipped rather than allow-listed by name. */
  const MONEY_ROUTES = ['/', '/listings', '/property/p5000', '/flatmates', '/list-property'];

  for (const route of MONEY_ROUTES) {
    test(`no two fixed layers overlap on ${route}`, async ({ page }) => {
      await page.addInitScript(() => {
        try {
          localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
        } catch { /* storage unavailable — the consent bar just stays up */ }
      });
      await page.goto(route, { waitUntil: 'domcontentloaded' });

      /* Wait for the chrome to exist rather than for a fixed delay. The bottom
         nav and sticky CTAs mount after hydration, and on a slow run a flat
         timeout let the probe measure an empty page — which tripped the
         "should have fixed chrome" guard below. That guard was doing its job:
         the bug was the wait, not the page. */
      await page.waitForFunction(() => {
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width >= 24 && r.height >= 24) return true;
        }
        return false;
      }, null, { timeout: 20000 });
      // Settle any entrance transition so a mid-animation box is never measured.
      await page.waitForTimeout(500);

      const clashes = await page.evaluate(() => {
        const layers = [];
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed') continue;
          if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
          // Anything inside an open overlay is meant to cover the page.
          if (el.closest('[role="dialog"], [aria-modal="true"], .sf-modal, .filter-panel.open, .filter-overlay.open')) continue;
          if (cs.pointerEvents === 'none') continue;
          const r = el.getBoundingClientRect();
          if (r.width < 24 || r.height < 24) continue;
          // A full-viewport fixed element is a backdrop, not competing chrome.
          if (r.width >= window.innerWidth * 0.98 && r.height >= window.innerHeight * 0.9) continue;
          layers.push({ el, r, cls: String(el.className || '').slice(0, 44), z: cs.zIndex });
        }

        const out = [];
        for (let i = 0; i < layers.length; i++) {
          for (let j = i + 1; j < layers.length; j++) {
            const a = layers[i]; const b = layers[j];
            // Nesting is composition, not collision.
            if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
            const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
            const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
            // 1px of touching edges is adjacency, not overlap.
            if (ox > 1 && oy > 1) {
              out.push(`${a.cls || a.el.tagName}(z=${a.z}) overlaps ${b.cls || b.el.tagName}(z=${b.z}) by ${Math.round(ox)}x${Math.round(oy)}px`);
            }
          }
        }
        return { count: layers.length, clashes: out };
      });

      // Guard against a vacuous pass: every consumer route has fixed chrome, so
      // finding none means the probe broke, not that the page is clean.
      expect(clashes.count, `${route} should have fixed chrome to check`).toBeGreaterThan(0);
      expect(clashes.clashes, `overlapping fixed layers on ${route}`).toEqual([]);
    });
  }
});
