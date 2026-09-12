import { test, expect } from '../../fixtures/live.js';
import { appReady } from '../../helpers/app.js';

/** Mobile sweeps require every visible interactive control to meet the 44px touch floor. */

const MIN_TAP = 44;

// Signed-out routes cover the mobile screens with publicly reachable controls.
const ROUTES = [
  '/', '/listings', '/saved', '/signin', '/signup', '/list-property',
  '/plans', '/emi-calculator', '/societies', '/help', '/flatmates', '/property/p5000', '/compare',
  '/society/skyline-heights-baner',
];

// Authenticated routes cover controls that only signed-in users can reach.
/* The tables below name a sign-in rather than binding one, because the `login` fixture is only
   available inside a test body. */
const AUTHED_ROUTES = [
  ['/dashboard', (login) => login.asOwner()],
  ['/messages', (login) => login.asOwner()],
];

// Staff routes cover mobile controls for field operations and moderation.
const STAFF_ROUTES = [
  ['/admin', (login) => login.asAdmin()],
  ['/ops', (login) => login.asStaff('rental')],
];

/* Reviewed exemptions — each must name why the control may be small.
   - `.hscroll-arrow` is display:none on coarse pointers (index.css); it is never
     tappable on a phone, but engines still report a box for it in some states.
   - `.sr-only` is the skip-link, a 1px box until it takes focus.
   - `[data-tap-exempt]` is the explicit opt-out for anything reviewed later. */
const EXEMPT = ['.hscroll-arrow', '.sr-only', '[data-tap-exempt]'];

/* The selector the sweep measures, hoisted so the readiness gate can count the same
   elements the assertion is about to walk. */
const SEL = 'button, a[href], [role="button"], [role="tab"], [role="option"], input[type="checkbox"], input[type="radio"], summary';

/* The readiness floor: below the sparsest real screen (auth, 7 controls) and far above the zero an
   unrendered document scores, which is the only distinction it has to make. */
const MIN_CANDIDATES = 5;

/** Long enough to span a React commit and a lazy chunk resolving; short enough that a fully static
 *  screen costs one of these and stops. */
const SETTLE_GAP_MS = 400;

/** A control count that never settles is real (a carousel would do it), so measure what is on screen
 *  rather than fail — the floor is re-asserted at measurement time anyway. */
const SETTLE_TRIES = 12;

/**
 * Wait until the number of tap-target candidates stops changing: what would invalidate the sweep is
 * that set still growing. Replaces `networkidle` — see `e2e/COVERAGE.md`.
 */
async function settled(page) {
  let prev = -1;
  for (let i = 0; i < SETTLE_TRIES; i += 1) {
    const now = await page.evaluate((sel) => document.querySelectorAll(sel).length, SEL);
    if (now === prev) return;
    prev = now;
    await page.waitForTimeout(SETTLE_GAP_MS);
  }
}

/** Pre-seed cookie consent so the bar never covers the controls we're measuring. */
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
 * Wait until the route has actually rendered, then sweep it. Four gates, none of them `networkidle`
 * — the reasoning for each is in `e2e/COVERAGE.md`.
 */
async function renderedSweep(page, route) {
  await appReady(page);
  await page.waitForFunction(
    ([sel, min]) => document.querySelectorAll(sel).length >= min,
    [SEL, MIN_CANDIDATES],
    { timeout: 15_000 },
  );
  await settled(page);

  const overlay = await page.evaluate(() => {
    const el = document.querySelector('vite-error-overlay');
    return el ? (el.shadowRoot?.querySelector('.message')?.textContent ?? 'present') : null;
  });
  expect(
    overlay,
    `${route} is showing the Vite error overlay, so the app never rendered:\n${overlay}`,
  ).toBeNull();

  /* Polled, not measured once: a full-screen route throws the shell away (/messages renders a bare
     spinner), so a single read in that window sees 0 elements on a healthy page. */
  let last = { candidates: 0, textLength: 0, undersized: [] };
  await expect
    .poll(async () => {
      last = await undersizedTargets(page, MIN_TAP, EXEMPT);
      return last.candidates;
    }, {
      timeout: 15_000,
      message: `${route} never rendered ${MIN_CANDIDATES} interactive elements — `
        + 'that is an unrendered or broken page, not a clean one. Refusing to report a pass.',
    })
    .toBeGreaterThanOrEqual(MIN_CANDIDATES);

  /* Then settle: controls drawn at exactly 44px report 43.99 mid-reflow. Kept separate from the poll
     above so a real violation does not surface under the "never rendered" message. */
  await expect
    .poll(async () => {
      last = await undersizedTargets(page, MIN_TAP, EXEMPT);
      return last.undersized.length;
    }, { timeout: 5_000, intervals: [200] })
    .toBe(0)
    .catch(() => {});

  expect(last.undersized, `undersized targets on ${route}:\n${JSON.stringify(last.undersized, null, 2)}`).toEqual([]);
}

/**
 * Measure every visible interactive element and return the ones under the floor. One `page.evaluate`
 * rather than per-locator round trips: a sweep is hundreds of elements across five routes.
 */
async function undersizedTargets(page, minTap, exempt) {
  return page.evaluate(([min, skip, SELECTOR]) => {
    /* WCAG 2.5.8 exempts a link sitting inside a sentence — it cannot be 44px
       without wrecking the prose. Detect that structurally rather than
       allow-listing every footer and legal link by hand. */
    const isInlineInText = (el) => {
      if (el.tagName !== 'A') return false;
      const p = el.parentElement;
      if (!p || !/^(P|SPAN|LI|LABEL|SMALL|EM|STRONG|DD|DT|TD)$/.test(p.tagName)) return false;
      return p.textContent.trim().length > el.textContent.trim().length;
    };

    /* WCAG 2.5.8 sizes the *target*, not the painted control: read the transparent extension's real
       geometry rather than trusting a class name. A `pointer-events: none` pseudo is decoration. */
    const targetBox = (el, r) => {
      let w = r.width;
      let h = r.height;
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(el, pseudo);
        if (!ps || ps.content === 'none' || ps.pointerEvents === 'none') continue;
        if (ps.position !== 'absolute' && ps.position !== 'fixed') continue;
        const pw = parseFloat(ps.width);
        const ph = parseFloat(ps.height);
        if (Number.isFinite(pw)) w = Math.max(w, pw);
        if (Number.isFinite(ph)) h = Math.max(h, ph);
      }
      return { w, h };
    };

    const out = [];
    let candidates = 0;
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (skip.some((s) => el.closest(s))) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      /* No pointer events, no pointer target: this is how the app parks closed drawers (the mobile
         filter panel sits at x=-57), and they are measured again once it opens. */
      if (cs.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      // Zero-box elements are collapsed/offscreen, not undersized targets.
      if (r.width === 0 || r.height === 0) continue;
      candidates += 1;
      const box = targetBox(el, r);
      if (box.w >= min && box.h >= min) continue;
      if (isInlineInText(el)) continue;
      /* A control inside a label or `.tap-target` row that is itself big enough passes: the hit
         area is the row. */
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
        /* Two decimals, not `Math.round`: the comparison is on the raw value, and 43.99 rounded
           prints "w: 44" — an impossible-looking result that invites loosening the floor. */
        w: Number(box.w.toFixed(2)),
        h: Number(box.h.toFixed(2)),
      });
    }
    return { candidates, textLength: document.body.innerText.length, undersized: out };
  }, [minTap, exempt, SEL]);
}

test.describe('Mobile tap-target sweep', () => {
  for (const route of ROUTES) {
    test(`every interactive element on ${route} clears ${MIN_TAP}px`, async ({ page }) => {
      await withConsent(page);
      await page.goto(route);
      await renderedSweep(page, route);
    });
  }

  test(`the property detail page clears ${MIN_TAP}px`, async ({ page }) => {
    await withConsent(page);
    await page.goto('/listings');
    await appReady(page);
    const card = page.locator('a[href^="/property/"]').first();
    await expect(card).toBeVisible();
    await card.click();
    /* A card tap is a client-side route change and moves no bytes, so wait for the URL — a network
       gate resolves instantly against the results page and re-measures /listings. */
    await page.waitForURL(/\/property\//);
    await renderedSweep(page, 'the property page');
  });

  /* The bottom nav's tabs are covered by the per-route sweeps above and in detail by
     mobile-bottom-nav.spec.js, so no third assertion here. */
});

test.describe('Mobile tap-target sweep — signed in', () => {
  for (const [route, signIn] of AUTHED_ROUTES) {
    test(`every interactive element on ${route} clears ${MIN_TAP}px`, async ({ page, login }) => {
      await withConsent(page);
      await signIn(login);
      await page.goto(route);
      await renderedSweep(page, route);
    });
  }
});

test.describe('Mobile tap-target sweep — staff surface', () => {
  for (const [route, signIn] of STAFF_ROUTES) {
    test(`every interactive element on ${route} clears ${MIN_TAP}px`, async ({ page, login }) => {
      await withConsent(page);
      /* Sign-in lands on the console itself, so this is a same-origin
         re-navigation rather than a fresh load. */
      await signIn(login);
      await page.goto(route);
      await renderedSweep(page, route);
    });
  }
});
