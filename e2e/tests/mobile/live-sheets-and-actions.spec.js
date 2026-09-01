import { test, expect } from '@playwright/test';
import { signedInAsNew } from '../../helpers/liveAuth.js';

/* Phase 2 of the mobile-only design work: overlays become bottom sheets, the
   listing wizard's step actions dock to the thumb arc, filters get a thumb-arc
   entry point on /listings, and the gallery gets a full-bleed hero + dot rail.

   These run under the `mobile` (412x915) and `mobile-small` (360x640) projects.
   Desktop non-leak assertions deliberately live in desktop-noleak-guardrails.spec.js
   instead — the mobile projects run with hasTouch, so a (pointer: coarse) or
   (hover: none) rule can never be disproved from here. */

const MIN_TAP = 44;

/** Cookie bar overlaps bottom-anchored chrome; pre-seed consent like the other specs do. */
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the bar just stays up */ }
  });
}

/* Seven `waitForLoadState('networkidle')` calls used to sit after the `goto`s below. Six of them
   were doing nothing at all: the very next statement was an auto-waiting `expect(...).toBeVisible()`
   or a `click()`, both of which are strictly stronger conditions. They were pure latency — and on
   `/listings`, which fetches a catalogue and lazy-loads tiles, latency that can turn into a 20s
   timeout on a page that rendered correctly. Worse, after `card.click()` the navigation is
   client-side, and `networkidle` after a client-side route change may never resolve at all: that is
   the failure this suite already diagnosed on the tap-target sweep, where the same route reached by
   `goto` passed and the click-navigated one timed out.

   The seventh (the injected-panel probe) genuinely needed a gate, because it reads computed styles
   off an element it creates itself and so has no natural thing to wait for. It waits for the app's
   own chrome instead — proof the stylesheet is live, which is the only precondition it has. */

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

    // ...and it must not be buried under the bottom nav. Asserted present rather than guarded:
    // these tests only run under the mobile projects, where the bottom nav is unconditional, so
    // `if (await nav.count())` could only ever hide its disappearance.
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
  test('step actions stay reachable without hunting for them', async ({ page }) => {
    await withConsent(page);
    /* This used to `test.skip(true, 'wizard gated (auth/paywall) in this environment')` when
       `.lp-step-actions` was missing -- and it was always missing, because `/list-property` is a
       ProtectedRoute (App.jsx) and the test never signed in. The skip was not describing an
       environment; it was describing the test's own omission, and it meant this assertion had
       never run. Signing in is the fix, and the step actions are then unconditional.

       A *new* owner, not `ACTORS.owner`: she holds four listings against a free-tier allowance of
       one, on purpose, so `/list-property` answers her with the upgrade prompt and this file's one
       wizard assertion would be waiting for a bar the paywall never renders. The skip that used to
       hide the missing sign-in would have hidden this too. */
    await signedInAsNew(page);
    await page.goto('/list-property');

    const actions = page.locator('.lp-step-actions').first();
    await expect(actions).toBeVisible({ timeout: 15_000 });

    // `sticky` is what keeps the row in flow so it can never cover the last field.
    await expect(actions).toHaveCSS('position', 'sticky');

    const primary = actions.locator('button').last();
    const b = await primary.boundingBox();
    expect(b.height).toBeGreaterThanOrEqual(MIN_TAP);
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

    // Roughly 4:3 — the point of the change is that it is no longer a 230px letterbox.
    expect(heroBox.height).toBeGreaterThan(vw * 0.6);

    // The desktop thumbnail strip must not be showing on a phone.
    await expect(page.locator('button.thumbnail').first()).toBeHidden();
  });
});
