import { test, expect } from '../../fixtures/live.js';

// Mobile projects cannot disprove touch-media leakage because they set hasTouch, so these run on desktop.
test.describe('Mobile-only rules do not leak to desktop', () => {
  test('the desktop home keeps its desktop chrome and interactions', async ({ page }) => {
    test.slow();
    // Seed consent so only the mobile bottom-nav inset remains in the reservation.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'dz_cookie_consent_v1',
          JSON.stringify({ necessary: 1, functional: 1, analytics: 1, marketing: 1, version: 1, ts: Date.now() }),
        );
      } catch {}
    });
    await page.goto('/');

    await test.step('the top bar never hides on scroll, even with the class applied', async () => {
      const bar = page.locator('nav.dz-topbar');
      await expect(bar).toBeVisible({ timeout: 20_000 });
      const before = await bar.boundingBox();
      // Navbar.jsx toggles this class at every width on purpose; the proof that
      // desktop is safe is that no rule outside the max-width block reads it.
      await page.evaluate(() => document.documentElement.classList.add('dz-nav-hidden'));
      await page.waitForTimeout(300);
      const after = await bar.boundingBox();
      expect(after.y).toBeCloseTo(before.y, 0);
      await expect(bar).toHaveCSS('transform', 'none');
      await page.evaluate(() => document.documentElement.classList.remove('dz-nav-hidden'));
    });

    await test.step('the mobile bottom nav occupies no space and no bottom inset is reserved', async () => {
      await expect(page.locator('nav.dz-bottom-nav')).toBeHidden();
      const pad = await page.locator('.has-bottom-nav').evaluate((el) => getComputedStyle(el).paddingBottom);
      expect(pad).toBe('0px');
    });

    await test.step('the button size ramp is mobile-only — desktop keeps 32/40/48', async () => {
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

    await test.step('the assistant FAB keeps its plain 24px corner offset', async () => {
      const gap = await page.locator('.dz-assistant-slot > div')
        .evaluate((el) => window.innerHeight - el.getBoundingClientRect().bottom);
      expect(Math.round(gap)).toBe(24);
    });

    await test.step('horizontal-scroll arrows survive on a fine pointer', async () => {
      await expect(page.locator('.hscroll-arrow').first()).toBeVisible();
    });

    await test.step('the hero search mode tabs keep their desktop height', async () => {
      const box = await page.locator('.hero-search-wrap').getByRole('button', { name: /^Buy$/ }).boundingBox();
      expect(box.height).toBeLessThan(44);
    });

    await test.step('overlays stay centred dialogs, not bottom sheets', async () => {
      const r = await page.evaluate(() => {
        const back = document.createElement('div');
        back.className = 'dz-modal-backdrop';
        const panel = document.createElement('div');
        panel.className = 'dz-modal';
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

    await test.step('footer columns are expanded, not collapsed accordions', async () => {
      // The accordion chevron is sm:hidden. One chevron per collapsible column, so assert across all
      // of them rather than picking .first() and leaving the rest unproven.
      const chevrons = page.locator('footer [data-footer-chevron]');
      await expect(chevrons).toHaveCount(3);
      const shown = await chevrons.evaluateAll((els) =>
        els.filter((el) => getComputedStyle(el).display !== 'none').length
      );
      expect(shown).toBe(0);
    });

    await test.step('the card lift survives the hover gate', async () => {
      const card = page.locator('.cat-card').first();
      await card.waitFor({ timeout: 20_000 });
      await card.scrollIntoViewIfNeeded();
      await card.hover();
      await expect
        .poll(() =>
          card.evaluate((el) => {
            // A regressed lift computes as `none`, which DOMMatrixReadOnly throws on — and a poll
            // swallows the throw. Report it as the 0 it means.
            const t = getComputedStyle(el).transform;
            return t === 'none' ? 0 : new DOMMatrixReadOnly(t).m42;
          }),
        )
        .toBeLessThan(0);
    });
  });

  test('on the light theme the desktop hero stays the dark island', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('dzAppPrefs', JSON.stringify({ theme: 'light' })));
    await page.goto('/');
    const hero = page.locator('section.hero-bg');
    await expect(hero).toHaveClass(/theme-dark/, { timeout: 20_000 });
    await expect(hero.locator('.hero-mist')).toHaveCount(0);
  });

  test('the home hero and Featured block keep their desktop structure', async ({ page }) => {
    test.slow();
    await page.goto('/');
    await expect(page.locator('.property-card').first()).toBeVisible();

    await test.step('the hero keeps its full-viewport height', async () => {
      const r = await page.evaluate(() => ({
        hero: Math.round(document.querySelector('section.hero-bg').getBoundingClientRect().height),
        vh: window.innerHeight,
      }));
      expect(r.hero).toBeGreaterThanOrEqual(r.vh);
    });

    await test.step('the inline search panel is still in the hero', async () => {
      await expect(page.locator('.hero-search-wrap')).toBeVisible();
      await expect(page.locator('.dz-search-sheet')).toHaveCount(0);
    });

    await test.step('trust chips and stats stay in the hero, and Browse-by-type stays above Featured', async () => {
      const y = await page.evaluate(() => {
        const top = (sel) => {
          const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().height > 0);
          return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
        };
        return { trust: top('.hero-trust'), stats: top('.hero-stats'), category: top('.cat-card'), featured: top('.property-card') };
      });
      expect(y.trust).toBeLessThan(y.category);
      expect(y.stats).toBeLessThan(y.category);
      expect(y.category).toBeLessThan(y.featured);
    });

    await test.step('the mobile trust-proof strip exposes no duplicate chips', async () => {
      await expect(page.locator('.hero-trust:visible')).toHaveCount(1);
      await expect(page.locator('.hero-stats:visible')).toHaveCount(1);
    });

    await test.step('the hero keeps its marketing sentence and the chips keep their pill shape', async () => {
      await expect(page.locator('p.hero-sub')).toBeVisible();
      await expect(page.locator('p.hero-sub')).toContainText(/\d/);
      const shape = await page.locator('.hero-trust:visible').evaluate((el) => ({
        display: getComputedStyle(el).display,
        radius: getComputedStyle(el.children[0]).borderRadius,
      }));
      expect(shape.display).toBe('flex');
      expect(shape.radius).toBe('9999px');
    });

    await test.step('the Featured subtitle is still shown', async () => {
      const shown = await page.evaluate(() => {
        const h = [...document.querySelectorAll('h2')].find((e) => /featured/i.test(e.textContent));
        const p = h && h.parentElement.querySelector('p');
        return !!p && p.getBoundingClientRect().height > 0;
      });
      expect(shown, 'the Featured subtitle is hidden on mobile only').toBe(true);
    });

    await test.step('the verified-homes proof stays inside the Featured header block', async () => {
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

    await test.step('the desktop vertical rhythm keeps its original per-section values', async () => {
      const r = await page.evaluate(() => ({
        gap: getComputedStyle(document.documentElement).getPropertyValue('--section-gap').trim(),
        heads: [...document.querySelectorAll('.section-head')]
          .filter((e) => e.getBoundingClientRect().height > 0)
          .map((e) => Math.round(parseFloat(getComputedStyle(e).marginBottom))),
      }));
      expect(r.gap).toBe('2.5rem');
      expect(r.heads.length).toBeGreaterThanOrEqual(4);
      expect(new Set(r.heads).size, `desktop gaps must stay varied, got ${r.heads}`).toBeGreaterThan(1);
      r.heads.forEach((h) => expect([12, 24, 32, 40]).toContain(h));
    });
  });

  test('the top bar row stays 72px at every desktop viewport', async ({ page }) => {
    test.slow();
    const rowHeight = () => page.evaluate(() => document.querySelector('.dz-topbar__row')?.getBoundingClientRect().height);

    await test.step('1440x900 keeps the 72px navbar row and token, pill and icon box', async () => {
      // The 10% height cut applies to --dz-nav-h below 768px only.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      const r = await page.evaluate(() => {
        const pill = document.querySelector('.dz-topbar__pill');
        const box = document.querySelector('.dz-topbar__icon-box');
        return {
          rowH: document.querySelector('.dz-topbar__row')?.getBoundingClientRect().height,
          token: getComputedStyle(document.documentElement).getPropertyValue('--dz-nav-h').trim(),
          inset: getComputedStyle(document.documentElement).getPropertyValue('--dz-top-inset').trim(),
          pillH: pill ? getComputedStyle(pill).height : null,
          boxH: box ? getComputedStyle(box).height : null,
        };
      });
      expect(r.rowH).toBe(72);
      expect(r.token).toBe('72px');
      expect(r.inset).toBe('72px');
      // `null` means the element is missing, not that there is nothing to check.
      expect(r.pillH, 'the desktop top bar must render a pill to measure').not.toBeNull();
      expect(r.boxH, 'the desktop top bar must render an icon box to measure').not.toBeNull();
      // 40px/32px are the phone values; desktop must not be pinned to either.
      expect(r.pillH).not.toBe('40px');
      expect(r.boxH).toBe('36px');
    });

    await test.step('the bottom bar and its slots stay absent on desktop', async () => {
      await expect(page.locator('nav.dz-bottom-nav')).toBeHidden();
      // The tab height is token-driven, so the count is what proves the bar itself is absent.
      expect(await page.locator('.dz-bottom-nav__tab:visible').count()).toBe(0);
    });

    // 1024x768 fails the max-height AND max-width landscape-phone guards; 1440x460 is landscape and
    // short but wide, so only the width guard holds it. A naive `(orientation: landscape)` rule breaks both.
    for (const [width, height] of [[1024, 768], [1440, 460]]) {
      await test.step(`${width}x${height} is not treated as a landscape phone`, async () => {
        await page.setViewportSize({ width, height });
        await page.goto('/');
        expect(await rowHeight()).toBe(72);
      });
    }
  });

  test('the listings page keeps its desktop layout', async ({ page }) => {
    test.slow();
    await page.goto('/listings');

    await test.step('the listings filters pill is mobile-only', async () => {
      // A rendered results grid is the proof the page got far enough for "the pill is not here" to
      // mean anything. Avoid `networkidle`: early absence assertions on client apps are vacuous.
      await expect(page.locator('a[href^="/property/"]').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('button.fixed.rounded-full', { hasText: /filter/i })).toBeHidden();
    });

    await test.step('the control height stays at its desktop value', async () => {
      const h = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--control-h').trim()
      );
      expect(h).toBe('40px');
    });

    await test.step('the calendar stays an anchored popover, not a bottom sheet', async () => {
      const r = await page.evaluate(() => {
        const cal = document.createElement('div');
        cal.className = 'dz-cal is-open';
        cal.style.cssText = 'height:260px;left:120px;top:80px';
        document.body.appendChild(cal);
        const rect = cal.getBoundingClientRect();
        const radius = getComputedStyle(cal).borderBottomLeftRadius;
        cal.remove();
        return { left: rect.left, width: rect.width, radius, vw: window.innerWidth };
      });
      expect(r.left).toBeCloseTo(120, 0);
      expect(r.width).toBeLessThan(r.vw);
      expect(r.radius).not.toBe('0px');
    });

    await test.step('dragging the filter drawer does nothing', async () => {
      // It is lg:hidden, so it is not interactive here anyway; assert the hook's own guard by driving it directly.
      await expect(page.locator('.filter-panel')).toHaveCount(1);
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

    await test.step('sub-headers that dock under the bar keep their desktop offset', async () => {
      await expect(page.locator('nav.dz-topbar')).toBeVisible({ timeout: 20_000 });
      await page.evaluate(() => document.documentElement.classList.add('dz-nav-hidden'));
      const inset = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--dz-top-inset').trim()
      );
      // Still resolves through --dz-nav-h; only the mobile block rewrites it to 0.
      expect(inset).not.toBe('0px');
      await page.evaluate(() => document.documentElement.classList.remove('dz-nav-hidden'));
    });

    await test.step('the property gallery keeps its thumbnail strip and fixed-height hero', async () => {
      const card = page.locator('a[href^="/property/"]').filter({ has: page.locator('img') }).first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await card.click();
      // A client-side route change never settles `networkidle`; the thumbnail strip is the gate.
      await expect(page.locator('button.thumbnail').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-gallery-dots]')).toBeHidden();
    });
  });

  test('the flatmates and sign-in pages keep their desktop rules', async ({ page }) => {
    await test.step('.tap-target does not override Tailwind display utilities', async () => {
      // .tap-target must not set `display`, or it would beat lg:hidden. The navbar's Back button is
      // the probe: it carries both classes and only renders off Home, hence /flatmates.
      await page.goto('/flatmates');
      await expect(page.getByRole('button', { name: /go back/i })).toBeHidden();
    });

    await test.step('the auth submit is not pinned and the meter keeps its full detail', async () => {
      await page.goto('/signin');
      // Every probe below injects a bare element and reads the computed rule, so the sign-in form
      // being on screen is the cheapest honest proof the app's stylesheet is live.
      await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 20_000 });
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
          submit: probe('dz-auth-submit'),
          // .lp-meter is sticky at every width by design; what must not leak is the mobile
          // compaction that strips it back.
          cheer: probe('lp-meter__cheer', 'p'),
          scale: probe('lp-meter__scale'),
        };
      });
      expect(probed.submit.position).toBe('static');
      expect(probed.cheer.display).not.toBe('none');
      expect(probed.scale.display).not.toBe('none');
    });
  });

  test('the wizard step actions are not sticky on desktop', async ({ page, login }) => {
    // Use a new signed-in owner so auth and paywall gates do not intercept the page.
    await login.asNewOwner();
    await page.goto('/list-property');
    const actions = page.locator('.lp-step-actions').first();
    await expect(actions).toBeVisible({ timeout: 20_000 });
    await expect(actions).toHaveCSS('position', 'static');
  });

  test('the saved tabs are a flex row, not a 3-up grid', async ({ page, login }) => {
    // Rahul is the seeded buyer with 2 saved listings, so `/saved` renders its tab strip rather
    // than an empty state. A `count()` guard would turn the auth gate into a silent skip.
    await login.asBuyer();
    await page.goto('/saved');
    const tabs = page.locator('.saved-tabs');
    await expect(tabs).toBeVisible({ timeout: 20_000 });
    await expect(tabs).toHaveCSS('display', 'flex');
  });
});
