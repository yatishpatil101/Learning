import { test, expect } from '@playwright/test';

/* Phase 3 of the mobile-only design work:
     - every bottom-anchored FAB docks to --pn-bottom-inset instead of hard-coding
       an offset, so nothing hides behind the tab bar
     - the control height ramps to the 44px touch floor, which lifts every
       dropdown option and shared field at once
     - date/time pickers become bottom sheets rather than anchored popovers
     - the auth submit and the wizard's progress meter stay pinned
     - taps get an explicit :active response now the native flash is suppressed
     - sheets and the filter drawer can be dragged away

   Runs under `mobile` (412x915) and `mobile-small` (360x640). Desktop non-leak
   assertions live in desktop-noleak-guardrails.spec.js — the mobile projects run
   with hasTouch, so a (pointer: coarse) / (hover: none) rule can never be
   disproved from here. */

const MIN_TAP = 44;

async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the bar just stays up */ }
  });
}

test.describe('Mobile control sizing', () => {
  test('the control height clears the touch floor, lifting fields and dropdown options with it', async ({ page }) => {
    await page.goto('/listings');
    const h = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--control-h').trim());
    expect(parseFloat(h)).toBeGreaterThanOrEqual(MIN_TAP);
  });

  test('a dropdown option is a real target, not a 40px sliver', async ({ page }) => {
    await page.goto('/listings');
    const height = await page.evaluate(() => {
      // Appended bare rather than inside .pn-dropdown__menu: the menu is hidden
      // until opened, which would collapse the measurement to zero.
      const opt = document.createElement('button');
      opt.className = 'pn-dropdown__option';
      opt.textContent = 'x';
      document.body.appendChild(opt);
      const r = opt.getBoundingClientRect().height;
      opt.remove();
      return r;
    });
    expect(height).toBeGreaterThanOrEqual(MIN_TAP - 0.5);
  });
});

test.describe('Bottom-anchored widgets', () => {
  test('the legal back-to-top button clears the tab bar and leaves the Nestor corner alone', async ({ page }) => {
    await withConsent(page);
    await page.goto('/privacy');
    // The route is lazy; networkidle can fire before the chunk mounts, which
    // would measure an empty document.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The button appears past 600px of scroll; if the page cannot travel that
    // far there is nothing to assert.
    const scrolled = await page.evaluate(() => {
      // `instant` matters: the app sets scroll-behavior: smooth, so a default
      // scrollTo would still be animating when scrollY is read.
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      return window.scrollY;
    });
    test.skip(scrolled <= 600, 'privacy page is too short to reveal the back-to-top button');

    const fab = page.locator('button[aria-label="Back to top"]');
    await expect(fab).toBeVisible();

    const [box, inset, viewport] = await Promise.all([
      fab.boundingBox(),
      page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pn-bottom-inset')) || 0),
      page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight })),
    ]);

    // Sits above whatever the inset reserves, not underneath it.
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.h - inset + 1);
    // Left half of the screen: the right corner belongs to the assistant.
    expect(box.x).toBeLessThan(viewport.w / 2);
    expect(box.width).toBeGreaterThanOrEqual(MIN_TAP);
  });
});

test.describe('Mobile pickers', () => {
  test('the calendar docks to the bottom edge instead of floating beside its trigger', async ({ page }) => {
    await page.goto('/listings');
    const r = await page.evaluate(async () => {
      const cal = document.createElement('div');
      cal.className = 'pn-cal is-open';
      cal.style.height = '260px';
      document.body.appendChild(cal);
      await Promise.all(cal.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
      const rect = cal.getBoundingClientRect();
      const radius = getComputedStyle(cal).borderBottomLeftRadius;
      cal.remove();
      return { left: rect.left, width: rect.width, bottom: rect.bottom, radius, vw: window.innerWidth, vh: window.innerHeight };
    });

    expect(r.left).toBeCloseTo(0, 0);
    expect(r.width).toBeCloseTo(r.vw, 0);
    expect(Math.abs(r.bottom - r.vh)).toBeLessThanOrEqual(1);
    expect(r.radius).toBe('0px');
  });
});

test.describe('Sticky primary actions', () => {
  test('the sign-in submit is pinned so the keyboard cannot bury it', async ({ page }) => {
    await page.goto('/signin');
    await page.waitForLoadState('networkidle');
    const position = await page.evaluate(() => {
      const el = document.querySelector('.pn-auth-submit');
      return el ? getComputedStyle(el).position : null;
    });
    // The button only renders once an OTP has been requested; assert the rule
    // rather than driving the whole OTP flow from a layout spec.
    if (position === null) {
      const rule = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.className = 'pn-auth-submit';
        document.body.appendChild(probe);
        const p = getComputedStyle(probe).position;
        probe.remove();
        return p;
      });
      expect(rule).toBe('sticky');
      return;
    }
    expect(position).toBe('sticky');
  });
});

test.describe('Touch feedback', () => {
  test('the native tap flash is replaced by an explicit pressed state', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const highlight = await page.evaluate(() => {
      const btn = document.querySelector('button');
      return btn ? getComputedStyle(btn).webkitTapHighlightColor : null;
    });
    // rgba(0, 0, 0, 0) is how `transparent` computes.
    expect(highlight).toContain('rgba(0, 0, 0, 0');
  });
});

test.describe('Drag to dismiss', () => {
  /* The panel slides in over a transition, and `toBeVisible` is satisfied the moment it
     has a box — including while it is still mostly off the left edge. Measuring then put
     the drag's start point over the backdrop rather than over the panel, so the gesture
     never armed and the drawer stayed open. Wait for two identical reads instead. */
  async function settledBox(locator) {
    let prev = null;
    await expect
      .poll(async () => {
        const box = await locator.boundingBox();
        const same = prev && box && prev.x === box.x && prev.width === box.width;
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
    await page.waitForLoadState('networkidle');
    await page.locator('button.fixed.rounded-full', { hasText: /filter/i }).first().click();
    await expect(page.getByRole('button', { name: /close filters/i })).toBeVisible();
    return settledBox(page.locator('.filter-panel.open'));
  }

  /* `useSwipeDismiss` writes an inline transform the moment the gesture arms, so this is
     the difference between "the drag was released short of the threshold" and "the drag
     was never seen at all". Without it the snap-back test below passes on a panel that
     ignored the pointer entirely — the exact vacuous pass this suite keeps finding. */
  const armed = (page) => page.locator('.filter-panel.open')
    .evaluate((el) => el.style.transform !== '');

  test('dragging the drawer back the way it came closes it', async ({ page }) => {
    const box = await openDrawer(page);

    const y = box.y + box.height / 2;
    const x = box.x + box.width - 20;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 30, y, { steps: 4 });
    expect(await armed(page), 'the drag never armed').toBe(true);
    await page.mouse.move(x - 160, y, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator('.filter-panel.open')).toHaveCount(0);
  });

  test('a short drag snaps back rather than dismissing', async ({ page }) => {
    const box = await openDrawer(page);

    const y = box.y + box.height / 2;
    const x = box.x + box.width - 20;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 20, y, { steps: 4 });
    expect(await armed(page), 'the drag never armed').toBe(true);
    await page.mouse.up();

    await expect(page.locator('.filter-panel.open')).toHaveCount(1);
  });

  test('the gesture never swallows a plain tap on a control inside the panel', async ({ page }) => {
    await openDrawer(page);
    await page.getByRole('button', { name: /close filters/i }).click();
    await expect(page.locator('.filter-panel.open')).toHaveCount(0);
  });
});
