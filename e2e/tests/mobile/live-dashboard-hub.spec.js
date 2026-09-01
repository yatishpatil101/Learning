import { test, expect } from '../../fixtures/live.js';
import { trackErrors } from '../../helpers/console.js';

/* The Account tab's headline metrics on a phone — §F P1 #18.

   OverviewPanel was a straight port of the desktop 4-up stat grid. On a 360px
   screen that is two dense rows of small numbers sitting between the user and
   everything actionable, at the top of a tab that already stacks 9+ sections.
   The split is: three metrics inline, the rest behind a "See all" sheet.

   The invariant that matters most is the last test — desktop must still get all
   four in one row, because the split is a mobile affordance, not a redesign. */

/* Consent is seeded rather than dismissed: the bar sits at z-1400 over the bottom of the
   viewport, which is exactly where the metrics sheet docks. The session itself now comes from a
   real sign-in — a hand-written `puneNestUser` object satisfied the mock's auth check but carries
   no token, so against the API every panel on this page would render its signed-out state. */
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the cookie bar just stays up */ }
  });
}

const seeAll = (page) => page.getByTestId('see-all-metrics');

test.describe('Mobile dashboard hub', () => {
  test('only three metrics render inline, with the rest behind See all', async ({ page, login }) => {
    await withConsent(page);
    await login.asBuyer();
    await page.goto('/dashboard');
    await seeAll(page).waitFor({ timeout: 15000 });

    await expect(seeAll(page), 'the overflow entry point is present').toBeVisible();

    // The inline grid is the See-all button's own parent, so counting the metric
    // labels that are *visible* there measures exactly what the user sees above
    // the fold. Visibility, not DOM membership: the overflow tiles are in the same
    // grid but `display: none` below `sm` (one grid, not two — tech-debt D82), so a
    // structural count would pass while showing the user something else entirely.
    const grid = page.locator('[data-testid="see-all-metrics"]').locator('xpath=..');
    // `p.truncate` is the Stat label and nothing else — the trend chip is a span,
    // and the See-all tile's own text is spans too.
    await expect(grid.locator('p.truncate:visible'), 'three metrics inline').toHaveCount(3);
  });

  test('See all opens a sheet containing every metric', async ({ page, login }) => {
    await withConsent(page);
    await login.asBuyer();
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

  test('the See all tile is a real tap target', async ({ page, login }) => {
    await withConsent(page);
    await login.asBuyer();
    await page.goto('/dashboard');
    await seeAll(page).waitFor({ timeout: 15000 });
    const box = await seeAll(page).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  });

  test('the metrics sheet docks to the bottom edge', async ({ page, login }) => {
    await withConsent(page);
    await login.asBuyer();
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

  test('desktop keeps all four metrics in one row and shows no See all', async ({ page, login }) => {
    // The split is a mobile affordance. A desktop user has the room for a 4-up row,
    // and an extra tap there would be a regression, not a simplification.
    await withConsent(page);
    await login.asBuyer();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');

    /* Every other test here gates on `seeAll(page).waitFor()`. This one cannot — the thing it is
       asserting is that the tile is absent — so it used `waitForLoadState('networkidle')`, which
       gated an assertion of *absence* on a signal that says nothing about whether the panel had
       rendered. An empty page passes that test perfectly.

       The gate is now the positive half of the same invariant: the metric labels themselves. That
       is what "all four in one row" means, so waiting for them and asserting the tile is absent are
       two halves of one claim, and there is no state of the page in which the wait succeeds and the
       assertion is vacuous.

       The count is unscoped and `>=` rather than `=== 4`, unlike the mobile test above. That test
       scopes to the See-all tile's parent grid — the one element this test is asserting does not
       exist — so the same scoping is unavailable here by construction. A floor of four is enough:
       it proves the panel painted, which is the only thing the `toBeHidden()` below needs, and it
       does not quietly become a second assertion about how many metrics the product has. */
    const metrics = page.locator('p.truncate:visible');
    await expect(metrics.first()).toBeVisible({ timeout: 15000 });
    expect(await metrics.count(), 'the metrics panel has painted').toBeGreaterThanOrEqual(4);
    await expect(seeAll(page)).toBeHidden();
  });

  test('the dashboard logs no console errors on a phone', async ({ page, login }) => {
    const errors = trackErrors(page);
    await withConsent(page);
    await login.asBuyer();
    await page.goto('/dashboard');
    await seeAll(page).waitFor({ timeout: 15000 });
    expect(errors).toEqual([]);
  });
});
