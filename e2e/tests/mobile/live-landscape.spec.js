import { test, expect } from '@playwright/test';

/* Landscape phones and dynamic type (review §F #24, §G.1).

   Rotating a phone was costing 31-34% of the viewport to chrome. The cause was not the
   bottom bar: the top navbar's height bump keys off `min-width: 768px`, and a landscape
   handset is ~915px wide, so it was being served the taller *desktop* navbar on a 412px-tall
   screen. Measured before the fix: 121px of chrome on a 360px-tall viewport.

   These specs set their own viewport, so they run identically under both mobile projects.
   The matching desktop non-leak assertions live in desktop-noleak-guardrails.spec.js —
   the mobile projects run with hasTouch, so nothing here can disprove a desktop leak. */

const seedConsent = async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        'dz_cookie_consent_v1',
        JSON.stringify({ necessary: 1, functional: 1, analytics: 1, marketing: 1, version: 1, ts: Date.now() }),
      );
    } catch {
      /* storage blocked — the bar just stays up, which no assertion here depends on */
    }
  });
};

const chrome = (page) =>
  page.evaluate(() => {
    const row = document.querySelector('.dz-topbar__row');
    const nav = document.querySelector('.dz-bottom-nav');
    const rowH = row ? row.getBoundingClientRect().height : 0;
    const navH = nav ? nav.getBoundingClientRect().height : 0;
    return { rowH, navH, vh: window.innerHeight, pct: ((rowH + navH) / window.innerHeight) * 100 };
  });

test.describe('Landscape phone', () => {
  test.use({ viewport: { width: 915, height: 412 } });

  test('top and bottom chrome both shrink, staying under a quarter of the viewport', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/');
    await expect(page.locator('nav.dz-bottom-nav')).toBeVisible();

    const c = await chrome(page);
    // 47 + 44 = 91 of 412. Before the landscape rules this was the desktop bar plus a
    // full-height tab bar, over 30% of the viewport.
    expect(c.rowH).toBe(47);
    expect(c.navH).toBe(44);
    expect(c.pct).toBeLessThan(25);
  });

  test('the docking token tracks the real navbar height', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/');
    // --dz-top-inset is where sticky sub-headers dock. If it and the rendered row
    // disagree, every sub-header slides under the navbar. The row now takes its height
    // *from* the token, so this asserts that wiring rather than two literals matching
    // by luck — hence comparing them to each other, not just to 47px.
    const inset = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--dz-top-inset').trim(),
    );
    const rowH = (await chrome(page)).rowH;
    expect(inset).toBe('47px');
    expect(rowH).toBe(parseFloat(inset));
  });

  test('tabs go icon-only but keep their accessible names and the 44px floor', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/');
    const bar = page.locator('nav.dz-bottom-nav');

    // Labels are hidden for space, so the name must come from aria-label.
    await expect(bar.getByRole('link', { name: /^Reels$/ })).toBeVisible();
    await expect(bar.getByRole('link', { name: /^Search$/ })).toBeVisible();

    const label = bar.locator('.dz-bottom-nav__label').first();
    await expect(label).toBeHidden();

    // Shrinking the bar must never take a slot below the tap-target minimum.
    const heights = await bar.locator('.dz-bottom-nav__tab').evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().height),
    );
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });

  test('the raised centre button stops overhanging the shorter bar', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/');
    const bar = page.locator('nav.dz-bottom-nav');
    const barBox = await bar.boundingBox();
    const fabBox = await bar.locator('.dz-bottom-nav__fab').boundingBox();
    // At 56px the circle overhung by 8px; on a 44px bar that would collide with content.
    expect(fabBox.y).toBeGreaterThanOrEqual(barBox.y - 1);
  });
});

test.describe('Portrait is unaffected by the landscape rules', () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test('keeps the full-height bars and visible labels', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/');
    const c = await chrome(page);
    expect(c.rowH).toBe(58);
    expect(c.navH).toBe(56);
    await expect(page.locator('.dz-bottom-nav__label').first()).toBeVisible();
  });
});

test.describe('Dynamic type', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  const setRootFont = (page, px) =>
    page.evaluate((v) => {
      document.documentElement.style.fontSize = v + 'px';
    }, px);

  test('bottom-bar labels actually scale with the root font size', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/');
    const label = page.locator('.dz-bottom-nav__label').first();
    await expect(label).toBeVisible();

    // 12px = the D134 legibility floor. Asserted as the *computed* size so this also
    // fails if styles/min-font-size.js ever floors the rule down to a px literal.
    const before = await label.evaluate((e) => getComputedStyle(e).fontSize);
    expect(before).toBe('12px');

    // The bug this guards: a px font-size is immune to the browser/OS font setting.
    // That looks safe (nothing ever overflows) but is the accessibility failure.
    // It has regressed once already — the D134 floor plugin rewrote this rule's rem
    // to `12px`, fixing legibility by killing dynamic type. 2x root => exactly 2x here.
    await setRootFont(page, 32);
    const after = await label.evaluate((e) => getComputedStyle(e).fontSize);
    expect(after).toBe('24px');
  });

  test('at 200% type nothing bursts the bar or the page', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/');
    await setRootFont(page, 32);

    const r = await page.evaluate(() => {
      const nav = document.querySelector('.dz-bottom-nav');
      const nb = nav.getBoundingClientRect();
      const labels = [...document.querySelectorAll('.dz-bottom-nav__label')];
      // The raised centre slot is structurally exempt: its 56px circle plus a label
      // needs ~74px inside a 56px bar, so at 200% type the label is squeezed. That is a
      // design decision (drop the redundant text under an already aria-labelled FAB),
      // not something to paper over here — tracked in tasks/todo.md. The four standard
      // tabs must be clean.
      const standard = labels.filter((l) => !l.parentElement.querySelector('.dz-bottom-nav__fab'));
      return {
        standardCount: standard.length,
        spill: standard.filter((l) => l.getBoundingClientRect().bottom > nb.bottom + 1).length,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        // Vertical clipping is where text is actually lost; horizontal is absorbed by
        // the ellipsis guard on purpose.
        vClipped: standard.filter((l) => l.scrollHeight > l.clientHeight + 1).length,
      };
    });

    expect(r.standardCount).toBeGreaterThanOrEqual(3);
    expect(r.spill).toBe(0);
    expect(r.overflowX).toBe(false);
    expect(r.vClipped).toBe(0);
  });
});
