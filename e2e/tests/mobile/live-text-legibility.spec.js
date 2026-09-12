import { test, expect } from '../../fixtures/live.js';

/* The 12px legibility sweep (D134).
 *
 * Its sibling `tap-targets.spec.js` asks "can a thumb hit this?"; this one asks
 * "can an eye read it?". Both are regression nets rather than feature tests: the
 * individual specs say what a screen should show, these two say nothing quietly
 * got smaller.
 *
 * The floor itself is enforced at build time by
 * `frontend/src/styles/min-font-size.js`, a PostCSS plugin that raises any
 * absolute `font-size` under 12px after Tailwind has expanded its utilities. That
 * is what makes the floor hold across 697 sub-12px declarations in 182 files
 * without a 182-file diff. This spec is the half that proves it, and — more
 * usefully — catches the sizes the plugin cannot reach: relative units whose
 * computed value depends on an ancestor (`em`, `%`, `smaller`), anything set from
 * JavaScript, and any stylesheet that arrives outside the build.
 *
 * Runs under `mobile` (412x915) and `mobile-small` (360x640); desktop is excluded
 * by the project config's testIgnore. A phone is where small type actually hurts.
 */

const MIN_FONT = 12;

/* Reviewed exemptions. Four reasons across five selectors (`sub`/`sup` are one
   reason), and it has to stay that way: a legibility sweep whose exemption list
   grows to cover each new failure is a decoration, not a gate. If a fifth reason
   looks necessary, that is a signal the floor is wrong or the screen is, and it
   should be argued rather than added.

   - `.sr-only`      visually hidden text for screen readers; it is never read with
                     the eye, so its rendered size is meaningless.
   - `sub`, `sup`    the browser applies `font-size: smaller` to these by spec. They
                     are typographic marks attached to a legible baseline (m², 1st),
                     not lines of copy, and forcing them to 12px breaks the very
                     relationship that makes them readable.
   - `svg`           text inside an SVG scales with the viewBox, so the computed px
                     reported here is not the size the user sees. Charts and icon
                     labels have to be judged on the rendered artwork instead.
   - `[data-text-exempt]`
                     the explicit opt-out, mirroring `[data-tap-exempt]` in the tap
                     sweep. Nothing carries it today; it exists so that a future
                     exception is a deliberate, greppable, reviewable mark in the
                     component rather than a new line in this array. */
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

/**
 * Every element that *renders its own text* below the floor.
 *
 * Keyed off text nodes rather than off elements, because font-size inherits: a
 * wrapper set to 11px whose children all override it back to 14px is not a
 * legibility problem, and walking elements would report it as one. The element
 * that owns the text node is the one that decides how that text looks.
 *
 * One page.evaluate rather than per-locator calls: a route can hold a couple of
 * thousand text nodes and a round trip each would make this spec slower than the
 * suite it protects.
 */
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

/**
 * The floor every sweep in this file asserts before it asserts the violation list is empty.
 *
 * <p>`expect(bad).toEqual([])` passes perfectly on a blank page, a crashed render or a 404 -- there
 * is nothing to be under {@link MIN_FONT}px when there is nothing at all. This file already knew
 * that: the comment above {@link ROUTES} explains that `/property/P5000` is a 404 with no five-stat
 * band, "so the sweep would have passed by finding nothing". The floor is that comment turned into
 * an assertion. The number is deliberately low; it is a smoke check that a page rendered, not a
 * content budget.
 *
 * <p><strong>Why 5, and how this number was arrived at.</strong> The first draft said 20, calibrated by
 * eye on the content routes, and it failed `/messages` at 12 -- then 10 failed it at 9. Both were
 * correct measurements wrongly judged. A signed-in owner with an empty inbox gets the nav, a heading
 * and an empty-state line, and that is the page working exactly as designed. A floor guessed from
 * the densest routes turns every legitimately sparse one into a false alarm, and a floor that cries
 * wolf is a floor somebody deletes. The number is now set below the sparsest real page this suite
 * visits (9 nodes on an empty `/messages`) and well above a blank render, which is what the
 * assertion was always for. {@link settled} does the primary work; this only backstops it.
 */
const MIN_MEASURED = 5;

/** Keep a failure message readable when a whole surface regresses at once. */
const report = (route, bad) =>
  `${bad.length} text node(s) under ${MIN_FONT}px on ${route}:\n`
  + JSON.stringify(bad.slice(0, 25), null, 2)
  + (bad.length > 25 ? `\n… and ${bad.length - 25} more` : '');

/* Public routes. `/property/p5000` is here for a specific reason: its five-stat
   band under the price rendered every one of its five labels at 11px, which is
   the example D134 was raised on. The slug is lower-case because the server
   matches it exactly — `P5000` is a 404, and a 404 page has no five-stat band to
   measure, so the sweep would have passed by finding nothing. */
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

/**
 * Waits until a route has painted enough to be worth measuring.
 *
 * <p><strong>Why not `waitForLoadState('networkidle')`.</strong> That is what this file used, and it
 * timed out after 20s on `/society/skyline-heights-baner` against a page that had in fact rendered
 * perfectly -- the failure artefact's own snapshot shows the breadcrumb, the hero image and the
 * Follow button all present. `networkidle` does not mean "the page is ready"; it means "no request
 * has been in flight for 500ms", which a surface with a hero image, lazily-loaded tiles or any
 * periodic beacon can simply never satisfy. It is a sleep with a network-shaped excuse: it makes
 * fast pages slow and busy pages fail, and it is silent about which it is doing.
 *
 * <p>What the sweep actually needs is that `main` has content in it. That is asserted directly here,
 * and {@link MIN_MEASURED} backstops it -- if a route paints its shell but nothing else, the floor
 * fails loudly with the route name rather than this helper failing with a timeout.
 */
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
