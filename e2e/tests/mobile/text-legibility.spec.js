import { test, expect } from '../../fixtures/live.js';

/* The floor is enforced at build time by styles/min-font-size.js; this sweep proves it and catches sizes the
   plugin cannot reach: relative units (em, %, smaller), JS-set sizes and stylesheets outside the build. */

const MIN_FONT = 12;

/* Keep exemptions to four reasons (sr-only, sub/sup, svg, [data-text-exempt]): a list that grows with each
   failure makes the sweep decoration, not a gate. A fifth reason means the floor or the screen is wrong. */
const EXEMPT = ['.sr-only', 'sub', 'sup', 'svg', '[data-text-exempt]'];

/** Pre-seed cookie consent so the bar never covers what we are measuring. */
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'dz_cookie_consent_v1',
        JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }),
      );
    } catch { /* storage unavailable — the bar just stays up */ }
  });
}

/** Keyed off text nodes because font-size inherits: an 11px wrapper with overriding children is fine. */
async function undersizedText(page, min, exempt) {
  return page.evaluate(([minPx, skip]) => {
    const seen = new Set();
    const out = [];
    let measured = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      if (skip.some((s) => el.closest(s))) continue;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      // Zero-box elements are collapsed or offscreen, not unreadable ones.
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      const size = parseFloat(cs.fontSize);
      if (!Number.isFinite(size)) continue;
      // Counted only once it is a real, visible, non-exempt piece of type -- which is exactly the
      // population the empty-list assertion is a claim about.
      measured += 1;
      if (size >= minPx) continue;

      const cls = el.className;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(cls && cls.baseVal !== undefined ? cls.baseVal : cls || '').slice(0, 80),
        text: node.nodeValue.trim().slice(0, 40),
        px: Math.round(size * 100) / 100,
      });
    }
    return { bad: out, measured };
  }, [min, exempt]);
}

/** Minimum text nodes measured before asserting no violations: an empty list passes on a blank or crashed
 * page. Set below the sparsest real route (9 nodes on an empty /messages) so sparse pages do not cry wolf. */
const MIN_MEASURED = 5;

/** Keep a failure message readable when a whole surface regresses at once. */
const report = (route, bad) =>
  `${bad.length} text node(s) under ${MIN_FONT}px on ${route}:\n`
  + JSON.stringify(bad.slice(0, 25), null, 2)
  + (bad.length > 25 ? `\n… and ${bad.length - 25} more` : '');

/* `/property/p5000` is included for its five-stat band under the price. Lower-case slug: the server matches
   exactly, and the 404 for `P5000` has no band to measure, so the sweep would pass finding nothing. */
const ROUTES = [
  '/',
  '/listings',
  '/property/p5000',
  '/societies',
  '/society/skyline-heights-baner',
  '/help',
  '/plans',
  '/flatmates',
];

/** Waits until `main` has content. `networkidle` is avoided: lazy tiles, hero images or periodic beacons can
 * keep it from ever settling, so it makes fast pages slow and busy pages fail. */
async function settled(page) {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('main')).not.toBeEmpty();
}

test.describe('Mobile text-legibility sweep', () => {
  for (const route of ROUTES) {
    test(`no text on ${route} renders under ${MIN_FONT}px`, async ({ page }) => {
      await withConsent(page);
      await page.goto(route);
      await settled(page);

      const { bad, measured } = await undersizedText(page, MIN_FONT, EXEMPT);
      expect(measured, `${route} rendered almost no text; the sweep proves nothing`).toBeGreaterThan(MIN_MEASURED);
      expect(bad, report(route, bad)).toEqual([]);
    });
  }
});

test.describe('Mobile text-legibility sweep — behind a session', () => {
  /* The densest screens in the product are the ones only a signed-in user sees,
     and density is where type gets shaved first. */
  for (const route of ['/dashboard', '/messages']) {
    test(`no text on ${route} renders under ${MIN_FONT}px`, async ({ page, login }) => {
      await withConsent(page);
      await login.asOwner();
      await page.goto(route);
      await settled(page);

      const { bad, measured } = await undersizedText(page, MIN_FONT, EXEMPT);
      expect(measured, `${route} rendered almost no text; the sweep proves nothing`).toBeGreaterThan(MIN_MEASURED);
      expect(bad, report(route, bad)).toEqual([]);
    });
  }

  test(`no text on /admin renders under ${MIN_FONT}px`, async ({ page, login }) => {
    await withConsent(page);
    await login.asAdmin();
    await settled(page);

    const { bad, measured } = await undersizedText(page, MIN_FONT, EXEMPT);
    expect(measured, '/admin rendered almost no text; the sweep proves nothing').toBeGreaterThan(MIN_MEASURED);
    expect(bad, report('/admin', bad)).toEqual([]);
  });
});
