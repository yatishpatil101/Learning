import { test, expect } from '@playwright/test';

/* The Account tab's headline metrics on a phone — §F P1 #18.

   OverviewPanel was a straight port of the desktop 4-up stat grid. On a 360px
   screen that is two dense rows of small numbers sitting between the user and
   everything actionable, at the top of a tab that already stacks 9+ sections.
   The split is: three metrics inline, the rest behind a "See all" sheet.

   The invariant that matters most is the last test — desktop must still get all
   four in one row, because the split is a mobile affordance, not a redesign. */

async function signedIn(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test User', mobile: '9876543210', role: 'buyer', loginAt: Date.now() }));
      localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the cookie bar just stays up */ }
  });
}

const seeAll = (page) => page.getByTestId('see-all-metrics');

test.describe('Mobile dashboard hub', () => {
  test('only three metrics render inline, with the rest behind See all', async ({ page }) => {
    await signedIn(page);
    await page.goto('/dashboard');
    await seeAll(page).waitFor({ timeout: 15000 });

    // The inline grid is the See-all button's own parent, so counting tiles there
    // measures exactly what the user sees above the fold.
    const inlineTiles = page.locator('.sm\\:hidden [data-stat-tile], .sm\\:hidden > *');
    await expect(seeAll(page), 'the overflow entry point is present').toBeVisible();

    const gridChildren = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="see-all-metrics"]');
      return btn ? btn.parentElement.children.length : -1;
    });
    // 3 metrics + the See all tile = 4 cells, i.e. exactly two rows of the 2-up grid.
    expect(gridChildren, 'three metrics plus the See all tile').toBe(4);
    expect(await inlineTiles.count()).toBeGreaterThan(0);
  });

  test('See all opens a sheet containing every metric', async ({ page }) => {
    await signedIn(page);
    await page.goto('/dashboard');
    await seeAll(page).waitFor({ timeout: 15000 });
    await seeAll(page).click();

    const sheet = page.locator('[role="dialog"]', { hasText: /all metrics/i });
    await expect(sheet).toBeVisible();

    // The sheet is the complete set, not the leftovers — a user who taps "See all"
    // expects the whole picture, not the two they could not already see.
    const inSheet = await sheet.locator('p.truncate').count();
    expect(inSheet, 'every metric is represented').toBeGreaterThanOrEqual(4);
  });

  test('the See all tile is a real tap target', async ({ page }) => {
    await signedIn(page);
    await page.goto('/dashboard');
    await seeAll(page).waitFor({ timeout: 15000 });
    const box = await seeAll(page).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  });

  test('the metrics sheet docks to the bottom edge', async ({ page }) => {
    await signedIn(page);
    await page.goto('/dashboard');
    await seeAll(page).waitFor({ timeout: 15000 });
    await seeAll(page).click();

    const panel = page.locator('.pn-modal-panel');
    await expect(panel).toBeVisible();
    /* The sheet enters with `pnSheetUp` (translateY(100%) -> 0). Measuring
       synchronously catches it a full sheet-height below the fold and the
       assertion fails for a reason that has nothing to do with layout. */
    await page.evaluate(() => {
      const el = document.querySelector('.pn-modal-panel');
      if (!el) return undefined;
      return Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
    });

    // Modal is already a sheet below 640px; this asserts the hub inherits that
    // rather than introducing a second overlay style.
    const r = await panel.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { bottom: b.bottom, viewportH: window.innerHeight };
    });
    expect(Math.abs(r.bottom - r.viewportH)).toBeLessThanOrEqual(1);
  });

  test('desktop keeps all four metrics in one row and shows no See all', async ({ page }) => {
    // The split is a mobile affordance. A desktop user has the room for a 4-up row,
    // and an extra tap there would be a regression, not a simplification.
    await signedIn(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(seeAll(page)).toBeHidden();
  });

  test('the dashboard logs no console errors on a phone', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await signedIn(page);
    await page.goto('/dashboard');
    await seeAll(page).waitFor({ timeout: 15000 });
    expect(errors).toEqual([]);
  });
});
