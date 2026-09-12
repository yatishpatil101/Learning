import { test, expect } from '../../fixtures/live.js';

/* Pull-to-refresh (frontend/src/lib/usePullToRefresh.js), mounted on /listings,
 * /saved, /notifications and /messages.
 *
 * This was previously written off as untestable on the grounds that Playwright
 * cannot produce a coarse pointer. It can: the `mobile` and `mobile-small`
 * projects both use `devices['Pixel 7']` (hasTouch + isMobile), which Chromium
 * reports as `(hover: none) and (pointer: coarse)` — the exact query the hook
 * gates on. The first test below asserts that outright, so if the emulation ever
 * changes this file fails with the reason rather than going quietly green.
 *
 * The gesture itself is dispatched over CDP (`Input.dispatchTouchEvent`).
 * `page.touchscreen` only exposes `tap`, and the hook binds its listeners by
 * hand — `touchmove` non-passively, because `preventDefault` is the whole point
 * — so the events have to be real trusted touch events, not synthetic
 * `TouchEvent`s from `page.evaluate`. CDP produces trusted ones.
 *
 * Every negative case ("this drag must NOT arm the pull") is paired with a
 * positive control from the *same* origin in the same test. Without that, a
 * badly chosen start point would make the negative pass for the wrong reason,
 * which is the one failure mode this file cannot afford.
 *
 * MUST live under tests/mobile/ — the config routes specs to a viewport project
 * by folder, and on the desktop project this gesture does not exist at all.
 */

/** The pull indicator: same markup on all four surfaces. Deliberately not a testid — it has none. */
const INDICATOR = 'div[aria-hidden="true"].glass-strong.pointer-events-none.rounded-full';

/** The hook's own gate. Asserted, not assumed. */
const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';

/* THRESHOLD 64, RESISTANCE 0.5, SLOP 6 → travel must exceed 6 + 64/0.5 = 134px
   to arm a refresh. These two sit either side of that on purpose. */
const PAST_THRESHOLD = 190;
const SHORT_OF_THRESHOLD = 40;

const consent = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }),
    );
  });

/**
 * A viewport point that lies in the page's ordinary content flow.
 *
 * Scans down the middle of the viewport for the first hit-test that is not the
 * fixed navbar, not a sticky bar, not inside a `data-no-ptr` region and not the
 * bare document — i.e. the highest point a thumb could land on and mean "pull".
 * Starting high is what leaves room to drag 190px without running off-screen on
 * the 360x640 `mobile-small` project.
 */
async function pullOrigin(page) {
  const point = await page.evaluate(() => {
    const pinned = (el) => {
      for (let n = el; n instanceof Element; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') return true;
      }
      return false;
    };
    const x = Math.round(window.innerWidth / 2);
    const limit = Math.round(window.innerHeight * 0.45);
    for (let y = 8; y < limit; y += 6) {
      const el = document.elementFromPoint(x, y);
      if (!el || el === document.documentElement || el === document.body) continue;
      if (el.closest('[data-no-ptr]')) continue;
      if (pinned(el)) continue;
      return { x, y };
    }
    return null;
  });
  expect(point, 'found a content point to start the drag from').not.toBeNull();
  return point;
}

/**
 * A point that genuinely lands inside a `data-no-ptr` region.
 *
 * Verified by hit-test rather than taken on trust from the bounding box: on the
 * 360x640 project the map can sit low enough that its box centre is below the
 * fold, and a touchStart outside the viewport would land on nothing — which
 * would make this test pass for entirely the wrong reason.
 */
async function optedOutOrigin(page) {
  const box = await page.locator('[data-no-ptr]').first().boundingBox();
  expect(box, 'the data-no-ptr region is laid out').not.toBeNull();
  const point = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + Math.min(24, box.height / 2)),
  };
  const onTarget = await page.evaluate(
    ({ x, y }) => {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return 'off-screen';
      const el = document.elementFromPoint(x, y);
      if (!el) return 'nothing under the point';
      return el.closest('[data-no-ptr]') ? 'ok' : `hit ${el.tagName}.${el.className}`;
    },
    point,
  );
  expect(onTarget, 'the drag really starts inside the opted-out region').toBe('ok');
  return point;
}

const touch = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 0, radiusX: 6, radiusY: 6, force: 1 }];

/**
 * Drag one finger from `origin` by (dx, dy) in `steps` moves, then lift.
 *
 * Stepped rather than a single jump so the slop, the axis decision and the
 * threshold are each actually crossed — a one-shot move would satisfy the
 * threshold while skipping the "which axis owns this gesture" branch entirely,
 * which is the branch this file most wants to exercise.
 *
 * @returns {Promise<() => Promise<void>>} a `release` that lifts the finger, so
 *   a caller can assert mid-gesture before the release settles it.
 */
async function drag(cdp, origin, { dx = 0, dy = 0, steps = 12 } = {}) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(origin.x, origin.y) });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: touch(origin.x + (dx * i) / steps, origin.y + (dy * i) / steps),
    });
  }
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
}

/**
 * Did the refresh spinner appear within `ms`?
 *
 * Polled inside the page rather than with `expect(...).toBeVisible()` because
 * MIN_SPIN_MS is 350 against a mock-backed refresh — the window is real but
 * short, and the same primitive has to answer "it span" and "it did not" so the
 * positive and negative cases are held to the same standard.
 */
function sawSpinner(page, ms = 1200) {
  return page.evaluate(
    async ([sel, budget]) => {
      const deadline = Date.now() + budget;
      while (Date.now() < deadline) {
        if (document.querySelector(`${sel} .animate-spin`)) return true;
        await new Promise((r) => { setTimeout(r, 20); });
      }
      return false;
    },
    [INDICATOR, ms],
  );
}

/** Run one full past-the-threshold pull and assert it refreshed. Used as a control. */
async function controlPull(page, cdp, origin) {
  const release = await drag(cdp, origin, { dy: PAST_THRESHOLD });
  await expect(page.locator(INDICATOR)).toBeVisible();
  await release();
  expect(await sawSpinner(page), 'the control pull refreshed').toBe(true);
  await expect(page.locator(INDICATOR)).toBeHidden();
}

/**
 * Open the listings page and wait until it has real content to pull against.
 *
 * The readiness probe has to match the VIEW: the grid/list renders property
 * anchors, but `view=map` renders markers inside the map instead and never mints
 * an `a[href^="/property/"]`, so the anchor probe can only ever time out there.
 */
async function openListings(page, url = '/listings') {
  await consent(page);
  await page.goto(url);
  const ready = url.includes('view=map')
    ? page.locator('[data-no-ptr]').first()
    : page.locator('a[href^="/property/"]').first();
  await expect(ready).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, 0));
}

test.describe('Pull to refresh', () => {
  test('the emulated device reports the coarse pointer the hook gates on', async ({ page, consoleErrors }) => {
    await openListings(page);
    const gate = await page.evaluate((q) => ({
      touch: window.matchMedia(q).matches,
      maxTouchPoints: navigator.maxTouchPoints,
    }), TOUCH_QUERY);

    // If this ever goes false the gesture is unmounted and every other test here
    // is testing nothing — which is exactly why it is asserted rather than assumed.
    expect(gate.touch).toBe(true);
    expect(gate.maxTouchPoints).toBeGreaterThan(0);
    expect(consoleErrors).toEqual([]);
  });

  test('a downward pull past the threshold shows the indicator and runs a refresh', async ({ page, context, consoleErrors }) => {
    await openListings(page);
    const cdp = await context.newCDPSession(page);
    const origin = await pullOrigin(page);

    const release = await drag(cdp, origin, { dy: PAST_THRESHOLD });

    // Mid-gesture: the indicator tracks the finger, so it is on screen before the
    // release — this is the affordance, and it is the half a user actually sees.
    const indicator = page.locator(INDICATOR);
    await expect(indicator).toBeVisible();

    await release();
    expect(await sawSpinner(page), 'the release ran a refresh').toBe(true);
    await expect(indicator).toBeHidden();
    expect(consoleErrors).toEqual([]);
  });

  test('a pull released short of the threshold snaps back without refreshing', async ({ page, context, consoleErrors }) => {
    await openListings(page);
    const cdp = await context.newCDPSession(page);
    const origin = await pullOrigin(page);

    // 40px of travel is past the 6px slop — so the gesture arms and the indicator
    // appears — but (40-6)*0.5 = 17px of pull, well under the 64px threshold.
    const release = await drag(cdp, origin, { dy: SHORT_OF_THRESHOLD, steps: 8 });
    await expect(page.locator(INDICATOR)).toBeVisible();

    await release();
    expect(await sawSpinner(page), 'a short pull must not refresh').toBe(false);
    await expect(page.locator(INDICATOR)).toBeHidden();
    expect(consoleErrors).toEqual([]);
  });

  test('a drag travelling more sideways than down is left to the card underneath', async ({ page, context, login, consoleErrors }) => {
    // /saved is the surface this rule exists for: its cards are swipe-to-dismiss,
    // and a real thumb swipe always carries a few pixels of downward drift. Before
    // the axis check, that drift armed the pull and preventDefault'd the swipe out
    // of existence.
    await consent(page);
    await login.asBuyer();
    await page.goto('/saved');
    await expect(page.locator('.saved-page')).toBeVisible({ timeout: 20000 });
    await page.evaluate(() => window.scrollTo(0, 0));

    const cdp = await context.newCDPSession(page);
    const origin = await pullOrigin(page);

    // Control: a straight pull from this exact origin does arm. Without this, the
    // negative below would pass just as happily from a dead spot on the page.
    await controlPull(page, cdp, origin);

    // Now the same origin, dragged 120px across and 60px down — downward travel
    // well past the 6px slop, but the horizontal axis is winning when it is
    // crossed, so the hook must stand down for the whole gesture.
    const release = await drag(cdp, origin, { dx: 120, dy: 60, steps: 12 });
    await expect(page.locator(INDICATOR)).toBeHidden();
    await release();
    expect(await sawSpinner(page), 'a sideways swipe must not refresh').toBe(false);
    await expect(page.locator(INDICATOR)).toBeHidden();
    expect(consoleErrors).toEqual([]);
  });

  test('a region marked data-no-ptr does not arm the pull', async ({ page, context, consoleErrors }) => {
    // The listings map. It is not an overflow scroller, so "is this at its top?"
    // answers yes for it — a downward pan would arm the pull, cancel the pan and
    // refetch the catalogue nobody asked to refetch. `data-no-ptr` is the opt-out.
    await openListings(page, '/listings?deal=buy&view=map&loc=Baner');
    const map = page.locator('[data-no-ptr]').first();
    await expect(map, 'the map renders (it is area-gated, hence ?loc=Baner)').toBeVisible({ timeout: 20000 });

    const cdp = await context.newCDPSession(page);

    // Control: pullOrigin skips data-no-ptr regions, so this lands on the content
    // above the map and proves the page's gesture is live.
    await controlPull(page, cdp, await pullOrigin(page));

    const release = await drag(cdp, await optedOutOrigin(page), { dy: PAST_THRESHOLD });
    await expect(page.locator(INDICATOR)).toBeHidden();
    await release();
    expect(await sawSpinner(page), 'a pan across the map must not refresh').toBe(false);
    expect(consoleErrors).toEqual([]);
  });

  test('the pull does not arm once the list has been scrolled away from the top', async ({ page, context, consoleErrors }) => {
    await openListings(page);
    const cdp = await context.newCDPSession(page);
    const origin = await pullOrigin(page);

    await controlPull(page, cdp, origin);

    await page.evaluate(() => window.scrollBy(0, 600));
    const scrolled = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
    expect(scrolled, 'the page actually scrolled').toBeGreaterThan(0);

    // Same origin, same pull. Away from the top a downward drag is a scroll and
    // stays one.
    const release = await drag(cdp, origin, { dy: PAST_THRESHOLD });
    await expect(page.locator(INDICATOR)).toBeHidden();
    await release();
    expect(await sawSpinner(page), 'a mid-list pull must not refresh').toBe(false);
    expect(consoleErrors).toEqual([]);
  });
});
