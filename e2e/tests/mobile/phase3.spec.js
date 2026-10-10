import { test, expect } from '@playwright/test';

/* Desktop non-leak assertions live in desktop-noleak-guardrails.spec.js: the mobile projects run with hasTouch,
   so a (pointer: coarse) / (hover: none) rule can never be disproved from here. */

const MIN_TAP = 44;

async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the bar just stays up */ }
  });
}

test.describe('Mobile control sizing', () => {
  test('the control height clears the touch floor, lifting fields and dropdown options with it', async ({ page }) => {
    await page.goto('/listings');
    const h = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--control-h').trim());
    expect(parseFloat(h)).toBeGreaterThanOrEqual(MIN_TAP);
  });
});

test.describe('Bottom-anchored widgets', () => {
  test('the legal back-to-top button clears the tab bar and leaves the Draaz corner alone', async ({ page }) => {
    await withConsent(page);
    await page.goto('/privacy');
    // The route is lazy; networkidle can fire before the chunk mounts, which
    // would measure an empty document.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The button appears past 600px of scroll.
    const scrolled = await page.evaluate(() => {
      // `instant` matters: the app sets scroll-behavior: smooth, so a default
      // scrollTo would still be animating when scrollY is read.
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      return window.scrollY;
    });
    expect(scrolled, 'the privacy page must be long enough to reveal the back-to-top button').toBeGreaterThan(600);

    const fab = page.locator('button[aria-label="Back to top"]');
    await expect(fab).toBeVisible();

    const [box, inset, viewport] = await Promise.all([
      fab.boundingBox(),
      page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dz-bottom-inset')) || 0),
      page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight })),
    ]);

    // Sits above whatever the inset reserves, not underneath it.
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.h - inset + 1);
    // Left half of the screen: the right corner belongs to the assistant.
    expect(box.x).toBeLessThan(viewport.w / 2);
    expect(box.width).toBeGreaterThanOrEqual(MIN_TAP);
  });
});

test.describe('Touch feedback', () => {
  test('taps get an explicit pressed state: no native flash, no stuck hover, a declared platform baseline', async ({ page }) => {
    // The cookie bar would sit over the card at 360x640 and swallow the synthetic hover.
    await withConsent(page);
    await page.goto('/');
    // The probes read the first `<button>`, so the gate must be that one exists — `networkidle`
    // would hand `expect` a `null` to complain about for the wrong reason.
    await expect(page.locator('button').first()).toBeVisible({ timeout: 15_000 });

    await test.step('the native tap flash is replaced by an explicit pressed state', async () => {
      const highlight = await page.evaluate(() => getComputedStyle(document.querySelector('button')).webkitTapHighlightColor);
      // rgba(0, 0, 0, 0) is how `transparent` computes.
      expect(highlight).toContain('rgba(0, 0, 0, 0');
    });

    await test.step('the platform baseline is declared: no tap delay, no landscape inflation, UA chrome on the light default', async () => {
      const base = await page.evaluate(() => {
        const html = getComputedStyle(document.documentElement);
        const btn = getComputedStyle(document.querySelector('button'));
        return {
          colorScheme: html.colorScheme,
          textSizeAdjust: html.webkitTextSizeAdjust,
          touchAction: btn.touchAction,
          userSelect: btn.userSelect || btn.webkitUserSelect,
        };
      });
      expect(base.colorScheme).toBe('light');
      expect(base.textSizeAdjust).toBe('100%');
      // Without it iOS Safari holds `click` for the double-tap-zoom window on some elements.
      expect(base.touchAction).toBe('manipulation');
      // A long press on a control must not raise the selection handles.
      expect(base.userSelect).toBe('none');
    });

    /* .cat-card, not .property-card: the Featured card's list-reveal animation pins transform,
       so its :hover lift cannot apply on any pointer; the rail has no animation, so it is the honest witness. */
    await test.step('a tapped card is not left hovering', async () => {
      const card = page.locator('.cat-card').first();
      // The Featured block above the rail fills in after the API answers and
      // pushes the rail down, out from under a resting pointer.
      await expect(page.locator('.property-card').first()).toBeVisible({ timeout: 15_000 });
      // Touch has no hover, so the browser fakes one on first tap and holds it until the next tap
      // elsewhere. Hovering here is the closest reproduction Playwright offers of that stuck state.
      expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
      // Without this the test is vacuous: an unraised card proves nothing if the synthetic hover never landed;
      // re-centre each pass as late layout shifts move it; `instant` because smooth scrolling is still moving it.
      await expect.poll(async () => {
        await card.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await card.hover();
        return card.evaluate((el) => el.matches(':hover'));
      }).toBe(true);
      await expect
        .poll(() => card.evaluate((el) => getComputedStyle(el).transform))
        .toBe('none');
    });
  });
});

test.describe('Drag to dismiss', () => {
  /* `toBeVisible` is satisfied while the panel is still mostly off the left edge, which put the
     drag's start point over the backdrop and never armed the gesture. */
  async function settledBox(locator) {
    let prev = null;
    await expect
      .poll(async () => {
        const box = await locator.boundingBox();
        const same = prev && box
          && prev.x === box.x
          && prev.y === box.y
          && prev.width === box.width
          && prev.height === box.height;
        prev = box;
        return Boolean(same);
      }, { timeout: 5_000, message: 'the filter drawer never stopped moving' })
      .toBe(true);
    return prev;
  }

  /** Opens the mobile filter drawer via the thumb-arc pill and returns its settled box. */
  async function openDrawer(page) {
    await withConsent(page);
    await page.goto('/listings');
    // No readiness gate needed: `click()` auto-waits for the pill to be actionable, which is
    // stronger than any load state — and `/listings` may never reach network idle.
    await page.locator('button.fixed.rounded-full', { hasText: /filter/i }).first().click();
    await expect(page.getByRole('button', { name: /close filters/i })).toBeVisible();
    return settledBox(page.locator('.filter-panel.open'));
  }

  /* useSwipeDismiss writes an inline transform the moment the gesture arms, separating "released short of the
     threshold" from "drag never seen", which the snap-back test below would otherwise pass on a dead panel. */
  const armed = (page) => page.locator('.filter-panel.open')
    .evaluate((el) => el.style.transform !== '');

  test('dragging the drawer back the way it came closes it', async ({ page }) => {
    const box = await openDrawer(page);

    const y = box.y + 24;
    const x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 4 });
    expect(await armed(page), 'the drag never armed').toBe(true);
    await page.mouse.move(x, y + 160, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator('.filter-panel.open')).toHaveCount(0);
  });

  test('a short drag snaps back rather than dismissing, and the gesture never swallows a plain tap on a control inside', async ({ page }) => {
    const box = await openDrawer(page);

    const y = box.y + 24;
    const x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 4 });
    expect(await armed(page), 'the drag never armed').toBe(true);
    await page.mouse.up();

    await expect(page.locator('.filter-panel.open')).toHaveCount(1);

    await page.getByRole('button', { name: /close filters/i }).click();
    await expect(page.locator('.filter-panel.open')).toHaveCount(0);
  });
});