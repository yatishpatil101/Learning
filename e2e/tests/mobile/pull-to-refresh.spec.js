import { test, expect } from '../../fixtures/live.js';

/* Gestures go over CDP Input.dispatchTouchEvent: the hook's non-passive touchmove needs trusted touch events.
   Must live under tests/mobile/ since the config picks the viewport project by folder. */

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

/** Highest content-flow point a thumb could land on, leaving room for a 190px drag on the 360x640 project. */
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

/** Hit-tested because the map's box centre can sit below the fold on 360x640, making the test pass vacuously. */
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

/** Stepped moves so slop, axis decision and threshold are each crossed; a single jump skips the axis branch.
 * Returns a `release` that lifts the finger so callers can assert mid-gesture. */
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

/** Polled in-page because the spinner shows for only MIN_SPIN_MS (350ms) and both outcomes need one probe. */
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

/** Readiness must match the view: `view=map` renders markers, never `a[href^="/property/"]` anchors. */
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
    // /saved cards are swipe-to-dismiss and a real thumb swipe always drifts a few pixels downward;
    // that drift must not arm the pull and preventDefault the swipe.
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

    // Same origin dragged 120px across and 60px down: horizontal wins past the 6px slop, so the hook stands down.
    const release = await drag(cdp, origin, { dx: 120, dy: 60, steps: 12 });
    await expect(page.locator(INDICATOR)).toBeHidden();
    await release();
    expect(await sawSpinner(page), 'a sideways swipe must not refresh').toBe(false);
    await expect(page.locator(INDICATOR)).toBeHidden();
    expect(consoleErrors).toEqual([]);
  });

  test('a region marked data-no-ptr does not arm the pull', async ({ page, context, consoleErrors }) => {
    // The map is not an overflow scroller, so it always reads as at-top and a downward pan would arm
    // the pull and refetch the catalogue; `data-no-ptr` is the opt-out.
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
