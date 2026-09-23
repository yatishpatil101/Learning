import { test, expect } from '@playwright/test';

/* Phone-only by construction: every rule guarded here is keyed off `hover`, `pointer: coarse` or a
 * safe-area inset, none of which the desktop project can observe. */

/** Cookie bar overlaps bottom-anchored chrome; pre-seed consent like the other mobile specs do. */
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the bar just stays up */ }
  });
}

const THUMB_PX = 44;

test.describe('Flatmates touch targets', () => {
  test.beforeEach(async ({ page }) => {
    await withConsent(page);
    await page.goto('/flatmates', { waitUntil: 'domcontentloaded' });
    await page.locator('.sf-card').first().waitFor({ state: 'visible', timeout: 30_000 });

    /* Both mobile projects are `hasTouch` and under 640px, so the gates under test are live.
       Asserted rather than assumed: under a fine pointer every test here passes vacuously. */
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches),
      'the project must emulate a touchscreen, or the hover gate is inactive').toBe(false);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
      'the project must emulate a touchscreen, or the tap-floor rules never apply').toBe(true);
  });

  test('a card never wears the lift a tap would leave stuck to it', async ({ page }) => {
    const card = page.locator('.sf-card').first();
    /* Scrolled in first. `.reveal` holds the card at translateY(36px) until an IntersectionObserver
       sees 12% of it, and Playwright's "visible" only means the box is non-empty — at 360x640 the
       first card sits far enough down that the entry offset is still applied, and the test would
       read that 36px as a stuck hover lift. A card out of view is also one no thumb can reach. */
    await card.scrollIntoViewIfNeeded();
    /* Vertical offset, not `transform: none`: the card also carries `.reveal`, which animates in
       and settles on an identity matrix, so the computed string is never `none`. */
    const lift = () => card.evaluate((el) => {
      const t = getComputedStyle(el).transform;
      return new DOMMatrixReadOnly(t === 'none' ? '' : t).m42;
    });

    await expect.poll(lift).toBe(0);
    await card.hover();
    // Past the .25s transition the rule would have run.
    await page.waitForTimeout(400);
    expect(await lift()).toBe(0);
  });

  test('every ghost button clears the thumb floor', async ({ page }) => {
    // Opened so the drawer's own Reset is on screen rather than translated off it.
    await page.locator('.filter-fab').click();
    await expect(page.locator('.filter-panel.open')).toBeVisible();

    const ghosts = page.locator('.btn-ghost:visible');
    /* One reachable instance as a guest — the rest sit on the empty state or need a signed-in
       author — so the floor is pinned on the rule as well as on this render, below. */
    expect(await ghosts.count()).toBeGreaterThan(0);

    const short = await ghosts.evaluateAll((els, floor) =>
      els
        .map((e) => ({ label: e.textContent.trim().slice(0, 24), h: +e.getBoundingClientRect().height.toFixed(2) }))
        .filter((b) => b.h < floor)
        .map((b) => `${b.label} @ ${b.h}px`),
    THUMB_PX);
    expect(short).toEqual([]);

    /* The rule is scoped to `.sf-page`, so a ghost rendered outside it — a portalled sheet, a
       shared component pulled onto the route — would escape the floor while still passing above. */
    const escaped = await ghosts.evaluateAll((els) =>
      els.filter((e) => !e.closest('.sf-page')).map((e) => e.textContent.trim().slice(0, 24)));
    expect(escaped).toEqual([]);

    /* `.btn-ghost` is the one button class with no rule in components/buttons.css, so it alone
       skipped the height every other button carries. The floor must stay behind `pointer: coarse`:
       --btn-h is 40px on a mouse, not unset, so an ungated rule would inflate the deliberately
       compact h-8 reissue pill and the h-9 empty-state button that no phone test can see. */
    const gate = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; } // cross-origin sheet
        for (const r of rules) {
          if (r.media && [...r.cssRules].some((c) => c.selectorText === '.sf-page .btn-ghost' && c.style.minHeight)) {
            return r.conditionText || r.media.mediaText;
          }
        }
      }
      return '';
    });
    expect(gate).toContain('pointer: coarse');
  });

  test('the filter drawer pads itself clear of the home indicator', async ({ page }) => {
    await page.locator('.filter-fab').click();
    const panel = page.locator('.filter-panel');
    await expect(panel).toBeVisible();

    // The drawer's base padding, with no inset to add.
    await expect(panel).toHaveCSS('padding-bottom', '24px');

    /* Headless Chrome reports every `env(safe-area-inset-*)` as 0, so the inset arrives through the
       token the rule already consumes. What this pins is that the padding comes from the route
       rule at all — the half a refactor drops, leaving Reset / Show results under the bar. */
    await page.addStyleTag({ content: ':root { --dz-safe-b: 34px; }' });
    await expect(panel).toHaveCSS('padding-bottom', '58px');

    /* The drawer is pinned to three edges and the manifest ships `orientation: any`, so the notch
       reaches it sideways too. Read off the declaration, because no headless inset can prove it. */
    const declared = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; } // cross-origin sheet
        for (const r of rules) {
          if (r.selectorText === '.sf-page .filter-panel') return r.style.cssText;
        }
      }
      return '';
    });
    expect(declared).toContain('safe-area-inset-top');
    expect(declared).toContain('safe-area-inset-left');
  });
});
