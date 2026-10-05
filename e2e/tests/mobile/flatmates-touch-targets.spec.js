import { test, expect } from '@playwright/test';

// Phone-only: these rules depend on touch media queries or safe-area insets.
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch {}
  });
}

const THUMB_PX = 44;

test.describe('Flatmates touch targets', () => {
  test.beforeEach(async ({ page }) => {
    await withConsent(page);
    await page.goto('/flatmates', { waitUntil: 'domcontentloaded' });
    await page.locator('.sf-card').first().waitFor({ state: 'visible', timeout: 30_000 });

    // Both mobile projects are `hasTouch` and under 640px, so the gates under test are live.
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches),
      'the project must emulate a touchscreen, or the hover gate is inactive').toBe(false);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
      'the project must emulate a touchscreen, or the tap-floor rules never apply').toBe(true);
  });

  test('a card never wears the lift a tap would leave stuck to it', async ({ page }) => {
    const card = page.locator('.sf-card').first();
    // Wait past `.reveal`; otherwise its entry offset looks like stuck hover lift.
    await card.scrollIntoViewIfNeeded();
    // Check vertical offset because `.reveal` leaves an identity transform string.
    const lift = () => card.evaluate((el) => {
      const t = getComputedStyle(el).transform;
      return new DOMMatrixReadOnly(t === 'none' ? '' : t).m42;
    });

    await expect.poll(lift).toBe(0);
    await card.hover();
    await page.waitForTimeout(400);
    expect(await lift()).toBe(0);
  });

  test('every ghost button clears the thumb floor', async ({ page }) => {
    const ghosts = page.locator('.btn-ghost:visible');

    const short = await ghosts.evaluateAll((els, floor) =>
      els
        .map((e) => ({ label: e.textContent.trim().slice(0, 24), h: +e.getBoundingClientRect().height.toFixed(2) }))
        .filter((b) => b.h < floor)
        .map((b) => `${b.label} @ ${b.h}px`),
    THUMB_PX);
    expect(short).toEqual([]);

    // `.sf-page` scope matters because portalled ghost buttons would escape the floor.
    const escaped = await ghosts.evaluateAll((els) =>
      els.filter((e) => !e.closest('.sf-page')).map((e) => e.textContent.trim().slice(0, 24)));
    expect(escaped).toEqual([]);

    // `.btn-ghost` lacks the shared button height rule.
    const gate = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
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

  test('the filter drawer pins Clear / Show above the home indicator', async ({ page }) => {
    // Opened so the drawer's own Reset is on screen rather than translated off it.
    await page.locator('.filter-fab').click();
    await expect(page.locator('.filter-panel.open')).toBeVisible();
    const actions = page.getByTestId('filter-drawer-actions');
    await expect(actions).toBeInViewport();

    await expect(actions).toHaveCSS('padding-bottom', '12px');
    // Headless Chrome reports safe-area env vars as 0, so the test uses the token.
    await page.addStyleTag({ content: ':root { --dz-safe-b: 34px; }' });
    await expect(actions).toHaveCSS('padding-bottom', '46px');
  });
});
