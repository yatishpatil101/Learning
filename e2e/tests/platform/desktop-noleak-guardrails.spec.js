import { test, expect } from '@playwright/test';

/* Desktop non-regression guardrails for the mobile-only design work.

   Every change in the mobile phase is scoped by a width media query, a `lg:hidden`
   utility, or a `(pointer: coarse)` / `(hover: none)` query. Those last two cannot be
   verified from the `mobile` project — Playwright's device descriptors set hasTouch,
   so `(pointer: coarse)` keeps matching no matter how the viewport is resized. This
   spec runs in the desktop `chromium` project (fine pointer, hover) and is the actual
   proof that none of the mobile rules leak. */

test.describe('Mobile-only rules do not leak to desktop', () => {
  test('the button size ramp is mobile-only — desktop keeps 32/40/48', async ({ page }) => {
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
    expect(h).toEqual([40, 32, 48]);
  });

  test('the mobile bottom nav occupies no space on desktop', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('nav.pn-bottom-nav')).toBeHidden();
  });

  test('no bottom inset is reserved on desktop', async ({ page }) => {
    /* The consent bar is fixed above the bottom edge at every width, and since D189 the
       layout reserves its real height so the footer is not born underneath it. That band
       is deliberately NOT mobile-only, so leaving it up here would make this guardrail
       fail for the one reason it is not testing. Seed a choice and the only thing left in
       the reservation is the mobile bottom-nav inset — which must be zero on desktop. */
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'pn_cookie_consent_v1',
          JSON.stringify({ necessary: 1, functional: 1, analytics: 1, marketing: 1, version: 1, ts: Date.now() }),
        );
      } catch { /* storage blocked — the bar stays up and the assertion below would catch it */ }
    });
    await page.goto('/');
    const pad = await page.locator('.has-bottom-nav').evaluate((el) => getComputedStyle(el).paddingBottom);
    expect(pad).toBe('0px');
  });

  test('the assistant FAB keeps its plain 24px corner offset', async ({ page }) => {
    await page.goto('/');
    const gap = await page.locator('.pn-assistant-slot > div')
      .evaluate((el) => window.innerHeight - el.getBoundingClientRect().bottom);
    // bottom-6 = 24px, i.e. calc(0px + 1.5rem) — the inset system is a no-op here.
    expect(Math.round(gap)).toBe(24);
  });

  test('horizontal-scroll arrows survive on a fine pointer', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hscroll-arrow').first()).toBeVisible();
  });

  test('.tap-target does not override Tailwind display utilities', async ({ page }) => {
    // .tap-target must not set `display`, or it would beat lg:hidden and leak a
    // mobile-only control onto the desktop navbar. The navbar's Back button is the
    // probe: it is the one element carrying both classes, and it only renders off
    // Home — hence the /flatmates navigation rather than /.
    await page.goto('/flatmates');
    await expect(page.getByRole('button', { name: /go back/i })).toBeHidden();
  });

  test('the hero search mode tabs keep their desktop height', async ({ page }) => {
    await page.goto('/');
    const box = await page.locator('.hero-search-wrap').getByRole('button', { name: /^Buy$/ }).boundingBox();
    // py-2 on a 14px/20px line box -> ~36px; the 44px floor is sm:-reset away.
    expect(box.height).toBeLessThan(44);
  });
  /* ---- Phase 2 mobile-only rules must not leak to desktop ---- */

  test('overlays stay centred dialogs, not bottom sheets', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(() => {
      const back = document.createElement('div');
      back.className = 'pn-modal-backdrop';
      const panel = document.createElement('div');
      panel.className = 'pn-modal';
      panel.style.height = '200px';
      back.appendChild(panel);
      document.body.appendChild(back);
      const cs = getComputedStyle(back);
      const ps = getComputedStyle(panel);
      const out = { align: cs.alignItems, radius: ps.borderBottomLeftRadius, width: panel.getBoundingClientRect().width };
      back.remove();
      return out;
    });
    expect(r.align).toBe('center');
    expect(r.radius).not.toBe('0px');
    // Still a constrained dialog, not full-bleed.
    expect(r.width).toBeLessThan(900);
  });

  test('the listings filters pill is mobile-only', async ({ page }) => {
    await page.goto('/listings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('button.fixed.rounded-full', { hasText: /filter/i })).toBeHidden();
  });

  test('the wizard step actions are not sticky on desktop', async ({ page }) => {
    await page.goto('/list-property');
    await page.waitForLoadState('networkidle');
    const actions = page.locator('.lp-step-actions').first();
    if (!(await actions.count())) test.skip(true, 'wizard gated in this environment');
    await expect(actions).toHaveCSS('position', 'static');
  });

  test('footer columns are expanded, not collapsed accordions', async ({ page }) => {
    await page.goto('/');
    // The accordion chevron is sm:hidden; on desktop every column body is visible.
    // There is one chevron per collapsible column, so assert across all of them
    // rather than picking .first() and leaving the rest unproven.
    const chevrons = page.locator('footer [data-footer-chevron]');
    await expect(chevrons).toHaveCount(3);
    const shown = await chevrons.evaluateAll((els) =>
      els.filter((el) => getComputedStyle(el).display !== 'none').length
    );
    expect(shown).toBe(0);
  });

  test('the property gallery keeps its thumbnail strip and fixed-height hero', async ({ page }) => {
    await page.goto('/listings');
    await page.waitForLoadState('networkidle');
    const card = page.locator('a[href^="/property/"]').first();
    if (!(await card.count())) test.skip(true, 'no listings rendered');
    await card.click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('button.thumbnail').first()).toBeVisible();
    // The mobile dot rail must not appear.
    await expect(page.locator('[data-gallery-dots]')).toBeHidden();
  });

  test('the saved tabs are a flex row, not a 3-up grid', async ({ page }) => {
    await page.goto('/saved');
    await page.waitForLoadState('networkidle');
    const tabs = page.locator('.saved-tabs');
    if (!(await tabs.count())) test.skip(true, 'saved page gated by auth in this environment');
    await expect(tabs).toHaveCSS('display', 'flex');
  });

  test('the top bar never hides on scroll, even with the class applied', async ({ page }) => {
    await page.goto('/');
    const bar = page.locator('nav.pn-topbar');
    const before = await bar.boundingBox();

    // Navbar.jsx toggles this class at every width on purpose; the proof that
    // desktop is safe is that no rule outside the max-width block reads it.
    await page.evaluate(() => document.documentElement.classList.add('pn-nav-hidden'));
    await page.waitForTimeout(300);

    const after = await bar.boundingBox();
    expect(after.y).toBeCloseTo(before.y, 0);
    await expect(bar).toHaveCSS('transform', 'none');
  });

  test('sub-headers that dock under the bar keep their desktop offset', async ({ page }) => {
    await page.goto('/listings');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.documentElement.classList.add('pn-nav-hidden'));

    const inset = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--pn-top-inset').trim()
    );
    // Still resolves through --pn-nav-h; only the mobile block rewrites it to 0.
    expect(inset).not.toBe('0px');
  });
});

/* Phase 3 systems: the control-height ramp, the picker sheets, the sticky auth
   submit and meter, the pressed-state feedback and the drag-to-dismiss gesture
   are all mobile-only. Each is asserted here to be inert at 1440x900 — these
   cannot live in a mobile-*.spec.js, which runs with hasTouch and so can never
   disprove a (pointer: coarse) / (hover: none) rule. */
test.describe('Desktop non-leak — phase 3', () => {
  test('the control height stays at its desktop value', async ({ page }) => {
    await page.goto('/listings');
    const h = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--control-h').trim()
    );
    expect(h).toBe('40px');
  });

  test('the calendar stays an anchored popover, not a bottom sheet', async ({ page }) => {
    await page.goto('/listings');
    const r = await page.evaluate(() => {
      const cal = document.createElement('div');
      cal.className = 'pn-cal is-open';
      cal.style.cssText = 'height:260px;left:120px;top:80px';
      document.body.appendChild(cal);
      const rect = cal.getBoundingClientRect();
      const radius = getComputedStyle(cal).borderBottomLeftRadius;
      cal.remove();
      return { left: rect.left, width: rect.width, radius, vw: window.innerWidth };
    });
    // Honours its inline anchor position and keeps all four corners rounded.
    expect(r.left).toBeCloseTo(120, 0);
    expect(r.width).toBeLessThan(r.vw);
    expect(r.radius).not.toBe('0px');
  });

  test('the auth submit is not pinned and the meter keeps its full detail', async ({ page }) => {
    await page.goto('/signin');
    await page.waitForLoadState('networkidle');
    const probed = await page.evaluate(() => {
      const probe = (cls, tag = 'div') => {
        const el = document.createElement(tag);
        el.className = cls;
        document.body.appendChild(el);
        const s = getComputedStyle(el);
        const out = { position: s.position, top: s.top, display: s.display };
        el.remove();
        return out;
      };
      return {
        submit: probe('pn-auth-submit'),
        // .lp-meter is sticky at every width by design (predates this work); what
        // must not leak is the mobile compaction that strips it back.
        cheer: probe('lp-meter__cheer', 'p'),
        scale: probe('lp-meter__scale'),
      };
    });
    expect(probed.submit.position).toBe('static');
    expect(probed.cheer.display).not.toBe('none');
    expect(probed.scale.display).not.toBe('none');
  });

  /* No desktop assertion for the pressed-state feedback: Chrome already computes
     -webkit-tap-highlight-color as rgba(0, 0, 0, 0) on a pointer device, so the
     property cannot distinguish "our rule applied" from "browser default". The
     rule is bounded by @media (hover: none), which a mouse never matches. */

  test('dragging the filter drawer does nothing', async ({ page }) => {
    await page.goto('/listings');
    await page.waitForLoadState('networkidle');
    const panel = page.locator('.filter-panel');
    if (!(await panel.count())) test.skip(true, 'no filter panel in this build');

    // It is lg:hidden, so it is not interactive here anyway; assert the hook's
    // own guard by driving it directly.
    const transform = await page.evaluate(() => {
      const el = document.querySelector('.filter-panel');
      const fire = (type, x) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: 300, bubbles: true, pointerId: 1 }));
      fire('pointerdown', 300);
      fire('pointermove', 200);
      fire('pointerup', 200);
      return el.style.transform;
    });
    expect(transform).toBe('');
  });
});

test.describe('Desktop non-leak — landscape & dynamic type (phase 4)', () => {
  /* The landscape block is guarded three ways: (orientation: landscape) AND
     (max-height: 500px) AND (max-width: 1023.98px). These prove each guard actually
     holds, rather than trusting the query by reading it. */

  test('1440x900 keeps the 72px navbar row and token', async ({ page }) => {
    // Desktop is deliberately untouched by the phone-only height reduction: the
    // 10% cut applies to --pn-nav-h below 768px only.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const r = await page.evaluate(() => ({
      rowH: document.querySelector('.pn-topbar__row')?.getBoundingClientRect().height,
      token: getComputedStyle(document.documentElement).getPropertyValue('--pn-nav-h').trim(),
      inset: getComputedStyle(document.documentElement).getPropertyValue('--pn-top-inset').trim(),
    }));
    expect(r.rowH).toBe(72);
    expect(r.token).toBe('72px');
    expect(r.inset).toBe('72px');
  });

  test('a landscape tablet at 1024x768 is not treated as a landscape phone', async ({ page }) => {
    // Fails the max-height AND max-width guards. This is the case a naive
    // `(orientation: landscape)` rule would have broken.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    const rowH = await page.evaluate(() => document.querySelector('.pn-topbar__row')?.getBoundingClientRect().height);
    expect(rowH).toBe(72);
  });

  test('a short desktop window stays desktop above the lg breakpoint', async ({ page }) => {
    // Landscape and short, but 1440 wide: the width guard is the one doing the work.
    await page.setViewportSize({ width: 1440, height: 460 });
    await page.goto('/');
    const rowH = await page.evaluate(() => document.querySelector('.pn-topbar__row')?.getBoundingClientRect().height);
    expect(rowH).toBe(72);
  });

  test('the phone-only pill shrink does not reach desktop', async ({ page }) => {
    /* .pn-topbar__pill and .pn-topbar__icon-box only take effect below sm. Above it
       the pills must fall back to their intrinsic padding-driven size, which is what
       lets the same markup serve both without a desktop regression. */
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const r = await page.evaluate(() => {
      const pill = document.querySelector('.pn-topbar__pill');
      const box = document.querySelector('.pn-topbar__icon-box');
      return {
        pillH: pill ? getComputedStyle(pill).height : null,
        boxH: box ? getComputedStyle(box).height : null,
      };
    });
    // 40px/32px are the phone values; desktop must not be pinned to either.
    if (r.pillH) expect(r.pillH).not.toBe('40px');
    if (r.boxH) expect(r.boxH).toBe('36px');
  });

  test('the bottom bar and its slots stay absent on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('nav.pn-bottom-nav')).toBeHidden();
    // The tab height is token-driven now; make sure that did not resurrect the bar.
    expect(await page.locator('.pn-bottom-nav__tab:visible').count()).toBe(0);
  });
});

test.describe('Home featured-first is mobile-only', () => {
  test('the hero keeps its full-viewport height', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(() => ({
      hero: Math.round(document.querySelector('section.hero-bg').getBoundingClientRect().height),
      vh: window.innerHeight,
    }));
    expect(r.hero).toBeGreaterThanOrEqual(r.vh);
  });

  test('the inline search panel is still in the hero', async ({ page }) => {
    // Mobile drops it entirely and sends the Search tab to /listings; desktop must be
    // untouched. The sheet that briefly replaced it on mobile no longer exists.
    await page.goto('/');
    await expect(page.locator('.hero-search-wrap')).toBeVisible();
    await expect(page.locator('.pn-search-sheet')).toHaveCount(0);
  });

  test('trust chips and stats stay in the hero, and Browse-by-type stays above Featured', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.property-card').first()).toBeVisible();
    const y = await page.evaluate(() => {
      const top = (sel) => {
        const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().height > 0);
        return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
      };
      return { trust: top('.hero-trust'), stats: top('.hero-stats'), category: top('.cat-card'), featured: top('.property-card') };
    });
    expect(y.trust).toBeLessThan(y.category);
    expect(y.stats).toBeLessThan(y.category);
    // Desktop section order is unchanged: Browse by type, then Featured.
    expect(y.category).toBeLessThan(y.featured);
  });

  test('the mobile trust-proof strip exposes no duplicate chips', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero-trust:visible')).toHaveCount(1);
    await expect(page.locator('.hero-stats:visible')).toHaveCount(1);
  });

  test('the hero keeps its marketing sentence and the chips keep their pill shape', async ({ page }) => {
    // Mobile swaps the sentence for the chips and redraws them as one panel;
    // desktop must keep the sentence and the four rounded-full pills.
    await page.goto('/');
    await expect(page.locator('p.hero-sub')).toBeVisible();
    await expect(page.locator('p.hero-sub')).toContainText(/\d/);
    const shape = await page.locator('.hero-trust:visible').evaluate((el) => ({
      display: getComputedStyle(el).display,
      radius: getComputedStyle(el.children[0]).borderRadius,
    }));
    expect(shape.display).toBe('flex');
    expect(shape.radius).toBe('9999px');
  });

  test('the Featured subtitle is still shown', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.property-card').first()).toBeVisible();
    const shown = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((e) => /featured/i.test(e.textContent));
      const p = h && h.parentElement.querySelector('p');
      return !!p && p.getBoundingClientRect().height > 0;
    });
    expect(shown, 'the Featured subtitle is hidden on mobile only').toBe(true);
  });

  test('the verified-homes proof stays inside the Featured header block', async ({ page }) => {
    // Mobile lifts this line out of the header to caption the rail. Desktop must
    // keep it where it was designed: stacked under the heading and subtitle,
    // inside the header column, above the tiles.
    await page.goto('/');
    await expect(page.locator('.property-card').first()).toBeVisible();
    const r = await page.evaluate(() => {
      const rect = (el) => el.getBoundingClientRect();
      const h2 = [...document.querySelectorAll('h2')].find((e) => /featured/i.test(e.textContent));
      const head = h2.closest('.section-head');
      const shown = [...document.querySelectorAll('p')]
        .filter((e) => e.querySelector('svg') && /verified/i.test(e.textContent) && rect(e).height > 0);
      return {
        count: shown.length,
        insideHeader: shown.length === 1 && head.contains(shown[0]),
        display: shown.length === 1 ? getComputedStyle(shown[0]).display : null,
      };
    });
    expect(r.count, 'exactly one copy of the proof line is visible').toBe(1);
    expect(r.insideHeader, 'desktop keeps the proof line in the Featured header').toBe(true);
    expect(r.display, 'desktop keeps the original inline-flex pill flow').toBe('inline-flex');
  });

  test('the desktop vertical rhythm keeps its original per-section values', async ({ page }) => {
    // Mobile collapses every section-header gap onto one token. Desktop must keep
    // the hand-authored values it was designed with, which is what the paired
    // sm:mb-* utilities restore once .section-head stops applying.
    await page.goto('/');
    await expect(page.locator('.property-card').first()).toBeVisible();
    const r = await page.evaluate(() => ({
      gap: getComputedStyle(document.documentElement).getPropertyValue('--section-gap').trim(),
      heads: [...document.querySelectorAll('.section-head')]
        .filter((e) => e.getBoundingClientRect().height > 0)
        .map((e) => Math.round(parseFloat(getComputedStyle(e).marginBottom))),
    }));
    expect(r.gap).toBe('2.5rem');
    expect(r.heads.length).toBeGreaterThanOrEqual(4);
    // 12 / 24 / 32 / 40px — the original mb-3 / mb-6 / mb-8 / mb-10.
    expect(new Set(r.heads).size, `desktop gaps must stay varied, got ${r.heads}`).toBeGreaterThan(1);
    r.heads.forEach((h) => expect([12, 24, 32, 40]).toContain(h));
  });
});