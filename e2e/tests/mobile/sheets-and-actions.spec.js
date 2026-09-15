import { test, expect } from '@playwright/test';
import { signedInAsNew } from '../../helpers/liveAuth.js';

/** Mobile projects cover sheets, listing controls, wizard actions, and gallery behavior. */

const MIN_TAP = 44;

/** Cookie bar overlaps bottom-anchored chrome; pre-seed consent like the other specs do. */
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the bar just stays up */ }
  });
}

// Assertions and actions provide stronger readiness checks than network idle.

test.describe('Mobile sheets', () => {
  test('the shared modal docks to the bottom edge as a sheet', async ({ page }) => {
    await withConsent(page);
    await page.goto('/listings');
    await expect(page.locator('nav.dz-topbar')).toBeVisible({ timeout: 20_000 });

    // Inject the shared panel classes rather than hunting for a modal trigger:
    // this asserts the *rule*, which is what the sheet conversion actually is.
    const box = await page.evaluate(async () => {
      const back = document.createElement('div');
      back.className = 'dz-modal-backdrop';
      const panel = document.createElement('div');
      panel.className = 'dz-modal';
      panel.style.height = '200px';
      back.appendChild(panel);
      document.body.appendChild(back);
      // The sheet slides up via `dzSheetUp`; measuring synchronously would catch it
      // at translateY(100%). Let the entry animation settle before reading geometry.
      await Promise.all(back.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
      const r = panel.getBoundingClientRect();
      const backRect = back.getBoundingClientRect();
      const align = getComputedStyle(back).alignItems;
      const radius = getComputedStyle(panel).borderBottomLeftRadius;
      back.remove();
      return { bottom: r.bottom, width: r.width, backBottom: backRect.bottom, backWidth: backRect.width, align, radius };
    });

    expect(box.align).toBe('flex-end');
    // Square bottom corners: the panel now meets the screen edge.
    expect(box.radius).toBe('0px');
    // Full-bleed and flush with the bottom of the viewport.
    expect(box.width).toBeCloseTo(box.backWidth, 0);
    expect(Math.abs(box.bottom - box.backBottom)).toBeLessThanOrEqual(1);
  });

  test('the modal close control meets the tap minimum', async ({ page }) => {
    await page.goto('/listings');
    const size = await page.evaluate(() => {
      const b = document.createElement('button');
      b.className = 'dz-modal-x';
      document.body.appendChild(b);
      const r = b.getBoundingClientRect();
      b.remove();
      return { w: r.width, h: r.height };
    });
    expect(size.w).toBeGreaterThanOrEqual(MIN_TAP);
    expect(size.h).toBeGreaterThanOrEqual(MIN_TAP);
  });
});

test.describe('Mobile listings controls', () => {
  test('a filters pill sits in the thumb arc and clears the bottom nav', async ({ page }) => {
    await withConsent(page);
    await page.goto('/listings');

    const pill = page.locator('button.fixed.rounded-full', { hasText: /filter/i }).first();
    await expect(pill).toBeVisible();

    const pillBox = await pill.boundingBox();
    expect(pillBox).not.toBeNull();
    expect(pillBox.height).toBeGreaterThanOrEqual(MIN_TAP);

    // It must live in the lower half of the screen — that is the whole point.
    const vh = page.viewportSize().height;
    expect(pillBox.y).toBeGreaterThan(vh / 2);

    // ...and it must not be buried under the bottom nav. Asserted present, not guarded: under the
    // mobile projects the nav is unconditional, so `if (await nav.count())` could only hide a bug.
    const nav = page.locator('nav.dz-bottom-nav');
    await expect(nav).toBeVisible();
    const navBox = await nav.boundingBox();
    expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(navBox.y + 1);
  });

  test('the filters pill opens the filter drawer', async ({ page }) => {
    await withConsent(page);
    await page.goto('/listings');

    await page.locator('button.fixed.rounded-full', { hasText: /filter/i }).first().click();
    // The drawer's close control is the reliable, label-stable marker.
    await expect(page.getByRole('button', { name: /close filters/i })).toBeVisible();
  });

  // Nested slider drags must not trigger the drawer's same-axis dismiss gesture.
  test('dragging the budget thumb moves the thumb, not the drawer', async ({ page }) => {
    await withConsent(page);
    await page.goto('/listings');
    await page.locator('button.fixed.rounded-full', { hasText: /filter/i }).first().click();

    const panel = page.locator('.filter-panel');
    await expect(panel).toHaveClass(/open/);
    // The panel slides in over 0.35s; measuring mid-transition would put the thumb somewhere it
    // is about to leave. `translateX(0)` settled is the resting position.
    await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');

    const maxThumb = page.getByRole('slider', { name: /budget range maximum/i });
    await expect(maxThumb).toBeVisible();
    const before = await maxThumb.inputValue();

    /* Press the thumb, not the element centre: the input is `pointer-events: none` with only the
       thumb pseudo-element re-enabled, so a mid-track click drives nothing. */
    const box = await maxThumb.boundingBox();
    const y = box.y + box.height / 2;
    const x = box.x + box.width - 10;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Well past the 72px dismiss threshold — a shorter drag would pass even unfixed.
    await page.mouse.move(x - 140, y, { steps: 14 });
    await page.mouse.up();

    await expect(panel).toHaveClass(/open/);
    await expect(page.getByRole('button', { name: /close filters/i })).toBeVisible();
    expect(Number(await maxThumb.inputValue())).toBeLessThan(Number(before));
  });

  test('dragging the drawer body still dismisses it', async ({ page }) => {
    await withConsent(page);
    await page.goto('/listings');
    await page.locator('button.fixed.rounded-full', { hasText: /filter/i }).first().click();

    const panel = page.locator('.filter-panel');
    await expect(panel).toHaveClass(/open/);
    await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');

    // The header strip — inside the panel, clear of every control, so this is the gesture itself.
    const box = await panel.boundingBox();
    const y = box.y + 12;
    const x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 140, y, { steps: 14 });
    await page.mouse.up();

    await expect(panel).not.toHaveClass(/open/);
  });

  test('view toggles and the drawer close button are 44px', async ({ page }) => {
    await withConsent(page);
    await page.goto('/listings');

    // Both toggles are permanent chrome on /listings, so a missing one is a regression rather
    // than a variant. `if (!(await btn.count())) continue` turned the whole loop into a no-op.
    for (const name of [/grid view/i, /list view/i]) {
      const btn = page.getByRole('button', { name }).first();
      await expect(btn, `${name} must be present to measure`).toBeVisible();
      const b = await btn.boundingBox();
      expect(b.width).toBeGreaterThanOrEqual(MIN_TAP);
      expect(b.height).toBeGreaterThanOrEqual(MIN_TAP);
    }

    await page.locator('button.fixed.rounded-full', { hasText: /filter/i }).first().click();
    const close = page.getByRole('button', { name: /close filters/i });
    const cb = await close.boundingBox();
    expect(cb.width).toBeGreaterThanOrEqual(MIN_TAP);
    expect(cb.height).toBeGreaterThanOrEqual(MIN_TAP);
  });
});

test.describe('Mobile wizard', () => {
  test('step actions sit at the end of the form and stay tappable', async ({ page }) => {
    await withConsent(page);
    // A new owner avoids fixture quotas and reaches the wizard actions.
    await signedInAsNew(page);
    await page.goto('/list-property');

    const actions = page.locator('.lp-step-actions').first();
    await expect(actions).toBeVisible({ timeout: 15_000 });

    // Fully in flow: nothing about this row floats over the fields above it.
    await expect(actions).toHaveCSS('position', 'static');

    // Compact, but never below the touch minimum.
    const primary = actions.locator('button').last();
    const b = await primary.boundingBox();
    expect(b.height).toBeGreaterThanOrEqual(MIN_TAP);
    expect(b.width, 'compact, not a full-width bar').toBeLessThan(page.viewportSize().width * 0.6);
  });
});

test.describe('Mobile property gallery', () => {
  test('the hero is full-bleed and the dot rail replaces thumbnails', async ({ page }) => {
    await withConsent(page);
    await page.goto('/listings');

    // The seeded catalogue always publishes approved listings, so "no listings rendered" describes
    // a broken /listings rather than an environment this spec does not apply to.
    const card = page.locator('a[href^="/property/"]').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();

    const hero = page.locator('.main-image-wrapper img').first();
    await expect(hero).toBeVisible({ timeout: 20_000 });

    const heroBox = await hero.boundingBox();
    const vw = page.viewportSize().width;
    // Full-bleed: the -mx-4 escape from the page gutter.
    expect(heroBox.width).toBeGreaterThanOrEqual(vw - 1);

    // A 4:3 minimum prevents a letterboxed hero on narrow screens.
    expect(heroBox.height).toBeGreaterThan(vw * 0.6);

    // The desktop thumbnail strip must not be showing on a phone.
    await expect(page.locator('button.thumbnail').first()).toBeHidden();
  });
});
