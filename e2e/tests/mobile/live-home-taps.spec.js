import { test, expect } from '@playwright/test';

// Mobile projects exercise coarse pointers; desktop coverage owns wider viewport assertions.

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
    expect(h).toEqual([44, 44, 48]);
  });

  test('Buy / Rent mode switching clears 44px', async ({ page }) => {
    // Phone search controls live on `/listings`, which the bottom navigation opens.
    await page.goto('/');
    const search = page.locator('nav.dz-bottom-nav').getByRole('link', { name: /^Search$/ });
    await expect(search).toBeVisible();
    await search.click();
    await expect(page).toHaveURL(/\/listings/);

    // Measure the transparent hit extension because the visual radio pill is intentionally compact.
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

    const capsule = page.locator('.deal-seg').first();
    const box = await capsule.boundingBox();
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  });

  test('the top bar carries no hamburger or Post button on a phone', async ({ page }) => {
    await page.goto('/');
    const bar = page.locator('nav.dz-topbar');
    await expect(bar.getByRole('button', { name: /toggle menu/i })).toHaveCount(0);
    await expect(page.locator('#mobile-nav')).toHaveCount(0);
    // Check both roles because the phone control can be rebuilt from a link into a button.
    await expect(
      bar.getByRole('link', { name: /post property/i })
        .or(bar.getByRole('button', { name: /post property/i })),
    ).toHaveCount(0);
  });

  test('a signed-out phone user can still reach Sign In from the top bar', async ({ page }) => {
    // This button keeps sign-in reachable after the phone drawer is removed.
    await page.goto('/');
    const signIn = page.locator('nav.dz-topbar').getByRole('link', { name: /^sign in$/i });
    await expect(signIn).toBeVisible();
  });

  test('top-bar pills are drawn under the tap floor but still hit 44px', async ({ page }) => {
    // `tap-extend` supplies the pointer target while the painted pill remains compact.
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

    // Measure the pseudo-element because it receives taps outside the painted box.
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
