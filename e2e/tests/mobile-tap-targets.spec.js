import { test, expect } from '@playwright/test';

/* The 44px sweep. Every earlier mobile spec asserts a specific control on a
   specific screen; this one walks the consumer routes a phone user actually
   travels and fails if *any* visible interactive element is under the touch
   floor. It's the regression net for the tap-target work — the individual specs
   say what should be right, this says nothing else quietly got worse.

   Runs under `mobile` (412x915) and `mobile-small` (360x640). Desktop is excluded
   by the project config's testIgnore, which is correct: the ramp is mobile-only. */

const MIN_TAP = 44;

/* Routes a signed-out phone user can reach. /saved renders its own guest surface,
   and /list-property is reachable (the wizard prompts for auth at submit). */
const ROUTES = ['/', '/listings', '/saved', '/signin', '/list-property'];

/* Reviewed exemptions — each must name why the control may be small.
   - `.hscroll-arrow` is display:none on coarse pointers (index.css); it is never
     tappable on a phone, but engines still report a box for it in some states.
   - `.sr-only` is the skip-link, a 1px box until it takes focus.
   - `.tap-extend` carries a 44px transparent ::before, so its own box is
     deliberately smaller than its hit area (index.css).
   - `[data-tap-exempt]` is the explicit opt-out for anything reviewed later. */
const EXEMPT = ['.hscroll-arrow', '.sr-only', '.tap-extend', '[data-tap-exempt]'];

/** Pre-seed cookie consent so the bar never covers the controls we're measuring. */
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'pn_cookie_consent_v1',
        JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }),
      );
    } catch { /* storage unavailable — the bar just stays up */ }
  });
}

/**
 * Measure every visible interactive element on the current page and return the
 * ones under the floor. Done in one page.evaluate rather than per-locator
 * boundingBox() calls: a sweep across five routes is hundreds of elements, and a
 * round trip each would make the spec slower than the suite it protects.
 */
async function undersizedTargets(page, minTap, exempt) {
  return page.evaluate(([min, skip]) => {
    /* WCAG 2.5.8 exempts a link sitting inside a sentence — it cannot be 44px
       without wrecking the prose. Detect that structurally rather than
       allow-listing every footer and legal link by hand. */
    const isInlineInText = (el) => {
      if (el.tagName !== 'A') return false;
      const p = el.parentElement;
      if (!p || !/^(P|SPAN|LI|LABEL|SMALL|EM|STRONG|DD|DT|TD)$/.test(p.tagName)) return false;
      return p.textContent.trim().length > el.textContent.trim().length;
    };

    const SEL = 'button, a[href], [role="button"], [role="tab"], [role="option"], input[type="checkbox"], input[type="radio"], summary';
    const out = [];
    for (const el of document.querySelectorAll(SEL)) {
      if (skip.some((s) => el.closest(s))) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      // Zero-box elements are collapsed/offscreen, not undersized targets.
      if (r.width === 0 || r.height === 0) continue;
      if (r.width >= min && r.height >= min) continue;
      if (isInlineInText(el)) continue;
      /* A control wrapped in a label or `.tap-target` row that is itself big
         enough passes: the hit area is the row, which is exactly the pattern
         `.tap-target` formalises (small glyph, grown hit area). */
      const host = el.closest('label, .tap-target');
      if (host && host !== el) {
        const hr = host.getBoundingClientRect();
        if (hr.width >= min && hr.height >= min) continue;
      }
      const cls = el.className;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(cls && cls.baseVal !== undefined ? cls.baseVal : cls || '').slice(0, 80),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
    return out;
  }, [minTap, exempt]);
}

test.describe('Mobile tap-target sweep', () => {
  for (const route of ROUTES) {
    test(`every interactive element on ${route} clears ${MIN_TAP}px`, async ({ page }) => {
      await withConsent(page);
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const bad = await undersizedTargets(page, MIN_TAP, EXEMPT);
      expect(bad, `undersized targets on ${route}:\n${JSON.stringify(bad, null, 2)}`).toEqual([]);
    });
  }

  test(`the property detail page clears ${MIN_TAP}px`, async ({ page }) => {
    await withConsent(page);
    await page.goto('/listings');
    await page.waitForLoadState('networkidle');
    const card = page.locator('a[href^="/property/"]').first();
    if (!(await card.count())) test.skip(true, 'no listings rendered in this environment');
    await card.click();
    await page.waitForLoadState('networkidle');

    const bad = await undersizedTargets(page, MIN_TAP, EXEMPT);
    expect(bad, `undersized targets on the property page:\n${JSON.stringify(bad, null, 2)}`).toEqual([]);
  });

  /* The bottom nav's own tabs are covered twice over: once by the per-route sweeps
     above (its links are in the DOM on every one of them) and once, in detail, by
     mobile-bottom-nav.spec.js. No third assertion here. */
});
