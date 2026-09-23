import { test, expect } from '@playwright/test';

/* Headless Chromium reports every `env(safe-area-inset-*)` as 0 and resolves `dvh` exactly like
 * `vh`, so the notch and URL-bar fixes are asserted against the *declared* value via the CSSOM. */

const withConsent = (page) => page.addInitScript(() => {
  try {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
  } catch { /* storage unavailable — the cookie bar just stays up */ }
});

/* Element-matched rather than selector-matched so a Tailwind arbitrary class does not have to be
 *  transcribed into the assertion, where it would drift the moment the utility changed. */
const declaredOn = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const out = [];
    /* Per-rule try/catch, not one around the sheet: a single rule the CSSOM refuses to expose would
       otherwise abandon the remaining few thousand and report an empty result. */
    const walk = (rules) => {
      for (const r of rules) {
        try {
          /* Selector first, and `cssRules` is not an else: CSS nesting gives every CSSStyleRule an
             (empty) rule list too, so recursing on its presence skips every declaration there is. */
          if (r.selectorText && el.matches(r.selectorText)) out.push(r.style.cssText);
          if (r.cssRules?.length) walk(r.cssRules);
        } catch { /* unexposable rule */ }
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch { /* cross-origin sheet */ }
    }
    return out.join(' ');
  }, selector);

const openDrawer = async (page) => {
  await page.goto('/listings');
  await page.locator('.filter-fab').click();
  const panel = page.locator('.filter-panel');
  await expect(panel).toHaveClass(/open/);
  // The panel slides in over 0.35s; measuring mid-transition reads a position it is about to leave.
  await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  return panel;
};

test.describe('Listings platform layer', () => {
  test('the viewport lets the Android keyboard resize the layout', async ({ page }) => {
    await page.goto('/listings');
    const content = await page.locator('meta[name="viewport"]').getAttribute('content');
    // Without this, Android Chrome overlays the keyboard instead of shrinking the viewport, and
    // the filter drawer's "Show N results" — a fixed bottom bar — is unreachable behind it.
    expect(content).toContain('interactive-widget=resizes-content');
    expect(content).toContain('viewport-fit=cover');
  });

  test('the browser does not run its own pull-to-refresh next to the app one', async ({ page }) => {
    await page.goto('/listings');
    const root = await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY);
    /* `usePullToRefresh` skips its preventDefault once the gesture is no longer cancellable, so a
       fast flick arms both indicators. Root, not body: `overflow-x: clip` blocks propagation. */
    expect(root, 'Chrome would otherwise refresh the page under the app indicator').toBe('contain');
  });

  test('paging a long result list is not an animated jump under reduced motion', async ({ page }) => {
    await withConsent(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    /* Recording the argument, not just the declaration: `behavior` defaults to `auto`, which defers
       to the computed `scroll-behavior`, so the guard is that `goToPage` passes NO behavior at all. */
    await page.addInitScript(() => {
      window.__scrollBehaviors = [];
      const native = window.scrollTo.bind(window);
      window.scrollTo = (opts, y) => {
        window.__scrollBehaviors.push(opts?.behavior);
        return native(opts, y);
      };
    });
    await page.goto('/listings');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');

    const next = page.getByRole('button', { name: 'Next page' });
    // A single page of results has no pager, and an absent control would pass this vacuously.
    await expect(next).toBeVisible();
    await next.click();
    // Recorded at all — otherwise the two assertions below hold over an empty list.
    await expect.poll(() => page.evaluate(() => window.__scrollBehaviors.length)).toBeGreaterThan(0);
    const behaviors = await page.evaluate(() => window.__scrollBehaviors);
    expect(behaviors.every((b) => b === undefined), `paging passed ${JSON.stringify(behaviors)}`).toBe(true);
  });

  test('scrolling the filter list to its end does not move the results page behind it', async ({ page }) => {
    await withConsent(page);
    const panel = await openDrawer(page);
    // The drawer is modal. Both are asserted because the panel is the fixed box and `.filter-scroll`
    // is the element that actually overflows — containing only one still chains.
    await expect(panel).toHaveCSS('overscroll-behavior-y', 'contain');
    await expect(panel.locator('.filter-scroll')).toHaveCSS('overscroll-behavior-y', 'contain');
  });

  test('the drawer keeps its primary action clear of the home indicator', async ({ page }) => {
    await withConsent(page);
    await openDrawer(page);
    const declared = await declaredOn(page, '[data-testid="filter-drawer-actions"]');
    expect(declared, 'the drawer action bar was not on screen').not.toBeNull();
    /* The computed value is 12px here and on a notched iPhone alike — emulation reports a 0 inset —
       so only the declaration distinguishes a bar that clears the gesture zone from one that does not. */
    expect(declared, '"Show N results" would sit under the gesture bar').toContain('--dz-safe-b');
  });
});
