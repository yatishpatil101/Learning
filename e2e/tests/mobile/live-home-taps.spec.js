import { test, expect } from '@playwright/test';

/* Home-page touch ergonomics. Scoped to `/` — the sweep across every consumer route
   comes with the later phases, and a scoped spec that actually passes is worth more
   than a global one full of allow-list exceptions.

   The matching desktop assertions live in desktop-mobile-guardrails.spec.js: the
   mobile projects run with hasTouch, so `(pointer: coarse)` rules cannot be
   disproved here just by widening the viewport. */

test.describe('Home tap targets and touch affordances', () => {
  test('the button size ramp lifts every size past the touch floor', async ({ page }) => {
    await page.goto('/');
    const h = await page.evaluate(() =>
      ['btn', 'btn btn-sm', 'btn btn-lg'].map((cls) => {
        const el = document.createElement('button');
        el.className = cls;
        document.body.appendChild(el);
        const height = Math.round(el.getBoundingClientRect().height);
        el.remove();
        return height;
      })
    );
    /* Was [44, 36, 48]. The 36 was the one rung of the ramp that did not clear the
       floor this test is named after, and .btn-sm is not a decorative variant —
       "Request number" on the property page, the button the whole contact funnel
       narrows to, carries it. index.css now lifts --btn-h-sm to 44px below 639px
       (desktop keeps 32px, which is where the density this variant exists for
       actually lives), so the assertion moves up with it rather than down. */
    expect(h).toEqual([44, 44, 48]);
  });

  test('Buy / Rent mode switching clears 44px', async ({ page }) => {
    // The panel no longer renders inline on a phone — the bottom nav's Search tab
    // goes to /listings, so that is where its tap targets have to be measured.
    await page.goto('/');
    const search = page.locator('nav.dz-bottom-nav').getByRole('link', { name: /^Search$/ });
    await expect(search).toBeVisible();
    await search.click();
    await expect(page).toHaveURL(/\/listings/);

    /* DealToggle exposes role=radio inside a radiogroup, not plain buttons.
     *
     * Measure the *hit* area, not the painted one. The pills are drawn at 36px on
     * purpose so the capsule around them lands on 44px — matching the sort
     * dropdown and query field they sit under — and `.tap-extend` restores the
     * finger target with a transparent 44px ::before (see index.css). Asserting
     * boundingBox() here would demand a 44px painted pill and fail against a
     * control that is behaving as designed; it is also why mobile-tap-targets'
     * sweep exempts `.tap-extend`. */
    for (const name of [/^Buy$/, /^Rent$/]) {
      const btn = page.getByRole('radio', { name }).first();
      await expect(btn).toBeVisible();
      const hit = await btn.evaluate((el) => {
        const own = el.getBoundingClientRect();
        const pseudo = getComputedStyle(el, '::before');
        const has = pseudo.content && pseudo.content !== 'none';
        return {
          height: Math.max(own.height, has ? parseFloat(pseudo.height) || 0 : 0),
          width: Math.max(own.width, has ? parseFloat(pseudo.width) || 0 : 0),
        };
      });
      expect(Math.round(hit.height), `${name} hit area is under the touch floor`)
        .toBeGreaterThanOrEqual(44);
      expect(Math.round(hit.width)).toBeGreaterThanOrEqual(44);
    }

    /* And the capsule itself stays on the 44px control rhythm — that is the
       promise the 36px pill is trading against. */
    const capsule = page.locator('.deal-seg').first();
    const box = await capsule.boundingBox();
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  });

  test('the top bar carries no hamburger or Post button on a phone', async ({ page }) => {
    /* Both moved out of the hardest-to-reach corner: the bottom tab bar now owns the
       five destinations the drawer used to list, and owns Post in its raised centre
       slot. Keeping either here would have been a second, competing copy. */
    await page.goto('/');
    const bar = page.locator('nav.dz-topbar');
    await expect(bar.getByRole('button', { name: /toggle menu/i })).toHaveCount(0);
    await expect(page.locator('#mobile-nav')).toHaveCount(0);
    await expect(bar.getByRole('link', { name: /post property/i })).toHaveCount(0);
  });

  test('a signed-out phone user can still reach Sign In from the top bar', async ({ page }) => {
    // The drawer used to be the only sign-in path below sm, so removing it had to
    // come with un-hiding this button — otherwise sign-in became unreachable.
    await page.goto('/');
    const signIn = page.locator('nav.dz-topbar').getByRole('link', { name: /^sign in$/i });
    await expect(signIn).toBeVisible();
  });

  test('top-bar pills are drawn under the tap floor but still hit 44px', async ({ page }) => {
    /* The pills used to be *painted* at 44px because .tap-target sets min-height,
       making the phone's chrome chunkier than the same pills on desktop. They now
       draw at --dz-nav-pill-h and carry .tap-extend, whose transparent 44px ::before
       keeps the finger target — so the drawn box may be smaller than 44 without
       breaking WCAG 2.5.8. This asserts both halves of that trade. */
    await page.goto('/');
    const pills = page.locator('nav.dz-topbar .dz-topbar__pill');
    const n = await pills.count();
    expect(n, 'the top bar should render at least one pill').toBeGreaterThan(0);

    for (let i = 0; i < n; i++) {
      const pill = pills.nth(i);
      await expect(pill).toHaveClass(/tap-extend/);
      const box = await pill.boundingBox();
      expect(Math.round(box.height), `pill ${i} drawn height`).toBe(40);
    }

    // The transparent hit area is a ::before, so measure it rather than the box.
    const hit = await pills.first().evaluate((el) => {
      const cs = getComputedStyle(el, '::before');
      return { w: parseFloat(cs.width), h: parseFloat(cs.height) };
    });
    expect(hit.w).toBeGreaterThanOrEqual(44);
    expect(hit.h).toBeGreaterThanOrEqual(44);
  });

  test('scroll arrows are removed on touch and every rail keeps an escape hatch', async ({ page }) => {
    await page.goto('/');
    const arrows = page.locator('.hscroll-arrow');
    const n = await arrows.count();
    expect(n, 'the arrows should still exist in the DOM, just not be shown').toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await expect(arrows.nth(i)).toBeHidden();

    for (const name of [/view all societies/i, /^all listings$/i, /view all properties/i]) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
  });
});
