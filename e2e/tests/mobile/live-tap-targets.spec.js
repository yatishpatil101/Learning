import { test, expect } from '../../fixtures/live.js';
import { appReady } from '../../helpers/app.js';

/* The 44px sweep. Every earlier mobile spec asserts a specific control on a
   specific screen; this one walks the consumer routes a phone user actually
   travels and fails if *any* visible interactive element is under the touch
   floor. It's the regression net for the tap-target work — the individual specs
   say what should be right, this says nothing else quietly got worse.

   Runs under `mobile` (412x915) and `mobile-small` (360x640). Desktop is excluded
   by the project config's testIgnore, which is correct: the ramp is mobile-only. */

const MIN_TAP = 44;

/* Routes a signed-out phone user can reach. /saved renders its own guest surface,
   and /list-property is reachable (the wizard prompts for auth at submit).

   The second row was added by F2. The first five were the routes the original
   sweep happened to cover; these are the ones the audit found undersized controls
   on (`/plans` 8px carousel dots, `/emi-calculator` 6px slider rails) plus the
   surfaces this session changed — a gallery dot rail, a society share button and
   a room share button are all new tap targets, and a sweep that does not walk
   them is not protecting them. */
const ROUTES = [
  '/', '/listings', '/saved', '/signin', '/signup', '/list-property',
  '/plans', '/emi-calculator', '/societies', '/help', '/flatmates', '/property/p5000', '/compare',
  '/society/skyline-heights-baner',
];

/* Routes behind a session, and who has to be signed in to reach them (D136).
   These were measured undersized and never swept, because the sweep only ever
   walked what a signed-out visitor can reach — which is precisely the half of the
   product a returning user spends the most time in.

   `/dashboard` is swept as an owner rather than a buyer: the owner branch renders
   strictly more (the enquiries and activity section heads, where the 48x20 "View
   all" affordances live), so it is the wider net of the two. */
/* The tables below name a sign-in rather than binding one, because the `login` fixture is only
   available inside a test body. */
const AUTHED_ROUTES = [
  ['/dashboard', (login) => login.asOwner()],
  ['/messages', (login) => login.asOwner()],
];

/* The staff surface. Field ops and moderators work these screens on a phone in
   somebody's stairwell, so the floor matters here at least as much as on the
   consumer side — it was skipped only because nobody had wired an authenticated
   fixture into a mobile spec. The `login` fixture already had one, so the
   deferral was stale. */
const STAFF_ROUTES = [
  ['/admin', (login) => login.asAdmin()],
  ['/ops', (login) => login.asStaff('rental')],
];

/* Reviewed exemptions — each must name why the control may be small.
   - `.hscroll-arrow` is display:none on coarse pointers (index.css); it is never
     tappable on a phone, but engines still report a box for it in some states.
   - `.sr-only` is the skip-link, a 1px box until it takes focus.
   - `[data-tap-exempt]` is the explicit opt-out for anything reviewed later.

   `.tap-extend` used to sit in this list and no longer does. Exempting it by class
   name meant the sweep took the helper's word for it: delete the 44px ::before from
   index.css and every `.tap-extend` control would still have passed, silently. The
   measurement below reads the pseudo-element's real geometry instead, so the class
   has to earn its pass on each run — and `.rng-val`, which hand-rolls the same
   transparent extension in listings.css without carrying the class, is credited for
   it too. Strictly more assertion than before, not less. */
const EXEMPT = ['.hscroll-arrow', '.sr-only', '[data-tap-exempt]'];

/* The selector the sweep measures, hoisted so the readiness gate can count the same
   elements the assertion is about to walk. */
const SEL = 'button, a[href], [role="button"], [role="tab"], [role="option"], input[type="checkbox"], input[type="radio"], summary';

/* The readiness floor. Not every screen is dense: the auth pages are the sparsest in
   the app at 7 controls (two fields, a reveal toggle, submit, and the three links out
   of it), while the busiest clear 150. Five sits below the thinnest real screen and
   far above the zero an unrendered document scores, which is the only distinction
   this number has to make. See `renderedSweep` for why it has to make it. */
const MIN_CANDIDATES = 5;

/** How long to leave between the two candidate counts `settled` compares. Long
 *  enough to span a React commit and a lazy chunk resolving; short enough that a
 *  fully static screen costs one of these and stops. */
const SETTLE_GAP_MS = 400;

/** How many times `settled` will re-sample before giving up and measuring anyway.
 *  A screen whose control count never stops moving is a real thing — a carousel
 *  mounting and unmounting slides would do it — and the honest response to that is
 *  to measure what is on screen, not to fail. The floor is re-asserted at
 *  measurement time regardless, so a genuinely empty document still cannot pass. */
const SETTLE_TRIES = 12;

/**
 * Wait until the number of tap-target candidates stops changing.
 *
 * Replaces `waitForLoadState('networkidle')`; see `renderedSweep` for why that was
 * the wrong question. This asks the right one: the sweep is about to walk a set of
 * elements, and what would invalidate it is that set still growing.
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
 * Wait until the route has actually rendered, then sweep it.
 *
 * This exists because the sweep it replaces could not tell a clean screen from a
 * blank one. The old gate was `waitForLoadState('networkidle')`, which is not an
 * app-readiness signal here: Vite fetches the whole module graph and only then
 * evaluates it, so on a cold route the last response lands about a second before
 * `main.jsx` runs. Measured on this app: last module at +251ms, `networkidle` at
 * +839ms with `document.body.innerText.length === 0`, `main.jsx` at +1181ms, first
 * render at +1702ms. The sweep therefore ran against an empty document, found zero
 * elements, and asserted `[] === []` — reporting a pass for a screen it never saw.
 * That is worse than having no sweep at all, and it is how a hundred-odd genuinely
 * undersized controls sat behind a green tick for as long as they did.
 *
 * Three gates now, in order:
 *   1. `appReady` — `main.jsx` sets `data-dz-boot="ready"` once the store and the
 *      one-shot migrations are done. A real signal rather than a coincidence.
 *   2. the candidate count clears `MIN_CANDIDATES`, which is what proves pixels
 *      exist: `appReady` fires just *before* the first render, so on its own it
 *      would trade one empty-document race for another.
 *   3. the candidate count stops moving. This was `waitForLoadState('networkidle')`,
 *      justified here as "now that the app is up it means what it says (route data
 *      has landed), which is where late list items stop arriving". It does not mean
 *      that, and the property detail page proved it: reached by clicking a card —
 *      a client-side route change — the page never produced 500ms of network
 *      silence inside 20s and the gate timed out, while the *same* route reached by
 *      `goto('/property/p5000')` passed in the sweep above. Nothing about the page
 *      differed; only how it was arrived at.
 *
 *      The gate was never really about the network. What it is protecting is the
 *      measurement: a control that arrives after the walk is a control the sweep
 *      never sized. So ask that question directly — sample the candidate count and
 *      wait for two consecutive readings to agree. That is strictly closer to the
 *      property being protected than "the browser stopped talking", it cannot be
 *      defeated by a page that keeps a request open, and it has a bound.
 *
 * The floor is re-asserted at measurement time, because a route that renders and
 * then throws its subtree away would otherwise slip through the same crack.
 *
 * The fourth gate was earned the hard way. `/flatmates` sat behind a green tick for
 * a whole run while `FilterBar.jsx` had a syntax error and Vite was serving a 500
 * for the module: the app shell — top bar, bottom nav, cookie banner — still renders
 * more than MIN_CANDIDATES interactive elements, so a broken route looks exactly
 * like a sparse one from a count alone. A candidate floor cannot distinguish them.
 * The overlay can: if `<vite-error-overlay>` is in the document, the page under it
 * is not the page we meant to measure, and no verdict about it is worth having.
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

  /* Measured under a poll rather than once. The gate above can be satisfied by the app
     shell alone — top bar, bottom nav, cookie bar — and a full-screen route then throws
     that shell away: /messages hides both bars and renders a bare spinner while its
     conversations land, so a single measurement taken in that window found 0 elements
     and 0 characters on a page that was healthy a second later. Polling keeps the guard
     doing its job (a route that never reaches the floor still fails, at the timeout,
     which is the unrendered-document case this floor exists for) without failing a
     legitimate loading state. */
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

  expect(last.undersized, `undersized targets on ${route}:\n${JSON.stringify(last.undersized, null, 2)}`).toEqual([]);
}

/**
 * Measure every visible interactive element on the current page and return the
 * ones under the floor, alongside the evidence that the page was worth measuring.
 * Done in one page.evaluate rather than per-locator boundingBox() calls: a sweep
 * across five routes is hundreds of elements, and a round trip each would make the
 * spec slower than the suite it protects.
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

    /* WCAG 2.5.8 sizes the *target* — the region that accepts the tap — not the
       painted control. Several controls here are deliberately drawn small and carry
       a transparent, absolutely-positioned pseudo-element to hold the finger-sized
       region (`.tap-extend` in index.css, `.rng-val::before` in listings.css). Read
       that geometry rather than trusting a class name, so the extension has to
       actually be present on the day the test runs. A pseudo with `pointer-events:
       none` is decoration and accepts nothing, so it does not count. */
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
      /* An element that accepts no pointer events is not a pointer target, so WCAG
         2.5.8 has nothing to size. This is not a loophole for small controls — it is
         how this app parks its closed drawers. The mobile filter panel on /listings
         stays mounted at x=-57 with `pointer-events: none` so it can animate back in,
         and without this the sweep dutifully measured six range labels no finger can
         reach, then reported them as violations. They become real targets when the
         drawer opens, at which point pointer-events returns to auto and they are
         measured like anything else. */
      if (cs.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      // Zero-box elements are collapsed/offscreen, not undersized targets.
      if (r.width === 0 || r.height === 0) continue;
      candidates += 1;
      const box = targetBox(el, r);
      if (box.w >= min && box.h >= min) continue;
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
        w: Math.round(box.w),
        h: Math.round(box.h),
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
    /* A card tap is a client-side route change, so it moves no bytes: the old
       `waitForLoadState('networkidle')` here resolved instantly against the results
       page and this test spent its life re-measuring /listings — which is why its
       failure list was character-for-character the /listings one. Wait for the URL. */
    await page.waitForURL(/\/property\//);
    await renderedSweep(page, 'the property page');
  });

  /* The bottom nav's own tabs are covered twice over: once by the per-route sweeps
     above (its links are in the DOM on every one of them) and once, in detail, by
     mobile-bottom-nav.spec.js. No third assertion here. */
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
