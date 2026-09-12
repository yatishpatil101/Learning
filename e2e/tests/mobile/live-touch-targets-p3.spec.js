import { test, expect } from '../../fixtures/live.js';

/* Touch-target floor on the controls the mobile audit measured below it.
 *
 * `mobile-tap-targets.spec.js` sweeps a set of consumer routes; none of the
 * controls below were in it, which is why a 6px slider rail, an 8px carousel dot
 * and a 28px admin icon button all survived. These assert the specific fixes so
 * they cannot silently regress.
 *
 * Measurement note: `boundingBox()` returns the *painted* box. Controls that keep
 * their drawn size and extend the hit area with a transparent `::before`
 * (`.tap-extend`, and the bespoke equivalents on `.rng-val`) are therefore measured
 * via the pseudo-element, not the box — see COVERAGE.md, "Unpainted tap targets". */

const consent = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }),
    );
  });

/** Height/width of an element's ::before, in CSS px. */
const pseudoBox = (locator) =>
  locator.evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return { w: parseFloat(s.width), h: parseFloat(s.height) };
  });

test.describe('Touch targets — controls the audit found under the floor', () => {
  test('EMI sliders give the finger a real strip, not a 6px rail', async ({ page }) => {
    await consent(page);
    await page.goto('/emi-calculator');

    const slider = page.locator('.emi-page input[type=range]').first();
    await expect(slider).toBeVisible();

    const box = await slider.boundingBox();
    // 32px is the deliberate value: enough to hit, short enough that three stacked
    // sliders still fit the fold. The rail stays *drawn* at 6px via background-size.
    expect(box.height, 'slider hit area').toBeGreaterThanOrEqual(28);

    const painted = await slider.evaluate((el) => getComputedStyle(el).backgroundSize);
    expect(painted, 'rail must still be drawn thin').toContain('6px');
  });

  test('the plans carousel dots are hittable and unambiguous', async ({ page }) => {
    await consent(page);
    await page.goto('/plans');

    const dots = page.locator('button[aria-current], button:has(> span[aria-hidden="true"].rounded-full)');
    const first = dots.first();
    await expect(first).toBeVisible();

    const a = await first.boundingBox();
    // 24x44: the WCAG 2.5.8 AA floor on the axis that is constrained, full height on
    // the axis that is free. See the comment in Plans.jsx for why not 44x44.
    expect(a.width, 'dot target width').toBeGreaterThanOrEqual(24);
    expect(a.height, 'dot target height').toBeGreaterThanOrEqual(40);

    // Adjacent targets must not overlap — two dots sharing pixels is worse than two
    // small dots, because neither tap goes where the user aimed.
    const count = await dots.count();
    if (count > 1) {
      const b = await dots.nth(1).boundingBox();
      expect(b.x, 'adjacent dots must not overlap').toBeGreaterThanOrEqual(a.x + a.width - 1);
    }
  });

  test('the property gallery dot rail meets the 24px its own comment promises', async ({ page }) => {
    await consent(page);
    await page.goto('/property/p5000');

    const dots = page.locator('[aria-label^="Go to photo"]');
    await expect(dots.first()).toBeVisible();

    // This rail was built with the comment "Each dot is a 24x44 box" — and shipped at
    // 22px, because px-2 (8px a side) around a w-1.5 (6px) dot is 22, not 24. The
    // fix is min-w-[24px] rather than more padding: the active dot is w-5, so a
    // padding change cannot pin both states at once. Measured 22 -> 24.
    const count = await dots.count();
    for (let i = 0; i < count; i++) {
      const b = await dots.nth(i).boundingBox();
      expect(b.width, `gallery dot ${i} width`).toBeGreaterThanOrEqual(24);
      expect(b.height, `gallery dot ${i} height`).toBeGreaterThanOrEqual(40);
    }
  });

  test('the budget slider value labels can be tapped to type a figure', async ({ page }) => {
    await consent(page);
    await page.goto('/listings');

    const val = page.locator('.rng-val').first();
    await expect(val).toBeVisible();

    // Drawn small on purpose (they are values, not buttons); the target is the
    // pseudo-element.
    const { w, h } = await pseudoBox(val);
    expect(w, 'value-label hit width').toBeGreaterThanOrEqual(44);
    expect(h, 'value-label hit height').toBeGreaterThanOrEqual(44);
  });
});

test.describe('Admin shell on a field phone', () => {
  test('the header icon buttons are named and hittable', async ({ page, login }) => {
    await consent(page);
    await login.asAdmin();

    for (const name of ['Open menu', 'Log out']) {
      const btn = page.getByRole('button', { name, exact: true });
      await expect(btn, `${name} must be reachable by its accessible name`).toBeVisible();
      const { w, h } = await pseudoBox(btn);
      expect(w, `${name} hit width`).toBeGreaterThanOrEqual(44);
      expect(h, `${name} hit height`).toBeGreaterThanOrEqual(44);
    }
  });

  test('no dashboard card overflows the viewport', async ({ page, login }) => {
    await consent(page);
    await login.asAdmin();

    /* The `waitForTimeout(500)` that used to sit here was standing in for this assertion, and did
       the job worse: it did not wait long enough on a slow run and did not fail when the cards
       never arrived. Waiting on the cards themselves also supplies the floor the sweep below
       needs -- `toEqual([])` is satisfied by a dashboard with no cards on it, which is the state a
       broken dashboard is in. */
    const cards = page.locator('.dz-card');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    const count = await cards.count();
    expect(count, 'the admin dashboard must render cards to measure').toBeGreaterThan(0);

    const vw = page.viewportSize().width;
    const overflowing = await page.evaluate((w) => {
      const bad = [];
      for (const el of document.querySelectorAll('.dz-card')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > w + 1) {
          bad.push(`${(el.innerText || '').trim().slice(0, 40)} → right=${Math.round(r.right)}`);
        }
      }
      return bad;
    }, vw);

    expect(overflowing, `cards escaping a ${vw}px viewport`).toEqual([]);
  });
});
