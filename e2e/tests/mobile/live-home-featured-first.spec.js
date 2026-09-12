import { test, expect } from '@playwright/test';

/* Home's mobile "3-second rule": a first-time visitor must see real inventory
   without scrolling.

   Before this phase the first Featured card sat at y=1406 on a Pixel 7 and
   y=1446 on a 360x640 phone — 1.5 and 2.3 screens down — because the hero
   carried min-h-[100dvh] plus 162px of trust chips and a 286px search panel.
   The fix moves search behind the bottom nav, replaces the hero's marketing
   sentence with the four proof chips, relocates the headline stats below the
   rail, and flips Featured above Categories with CSS `order`.

   The desktop half of this contract lives in desktop-noleak-guardrails.spec.js:
   the mobile projects run with hasTouch, so nothing here can prove a desktop
   value is unchanged. */

const consent = { necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() };

// Home is lazy-routed, so a bare goto can return before React has painted the
// hero. Every measurement below is a layout read — waiting for the rail to be
// present is what makes them deterministic under parallel workers.
async function gotoHome(page) {
  await page.goto('/');
  await page.locator('section.hero-bg').waitFor({ state: 'attached' });
  await page.locator('.property-card').first().waitFor();
}

test.beforeEach(async ({ page }) => {
  // A partial consent object is rejected by CookieConsent and the bar stays
  // mounted at z-1400, silently intercepting taps on anything bottom-anchored.
  await page.addInitScript((c) => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify(c));
  }, consent);
});

test.describe('Home mobile — featured first', () => {
  test('a real property card is visible without scrolling', async ({ page }) => {
    await gotoHome(page);
    const card = page.locator('.property-card').first();
    await expect(card).toBeVisible();

    const box = await card.boundingBox();
    const vh = page.viewportSize().height;
    expect(box.y, `first card top ${Math.round(box.y)} must be inside the ${vh}px fold`).toBeLessThan(vh);
    // Not just the top edge peeking — enough card to read as a property.
    expect(box.y + 120, 'at least 120px of the card should be on screen').toBeLessThan(vh);
  });

  test('the hero no longer reserves a full viewport', async ({ page }) => {
    await gotoHome(page);
    const h = await page.locator('section.hero-bg').evaluate((el) => el.getBoundingClientRect().height);
    expect(h, 'min-h-[100dvh] must be lg-only').toBeLessThan(page.viewportSize().height);
  });

  test('the four proof chips lead the hero, in at most two rows', async ({ page }) => {
    // They replace the marketing sentence on mobile: a phone visitor gets the
    // four objections answered above the fold. Two rows is the budget — a third
    // row pushes Featured out of the fold, which test 1 guards.
    await gotoHome(page);
    const chips = page.locator('.hero-trust:visible > *');
    await expect(chips).toHaveCount(4);
    await expect(page.locator('p.hero-sub')).toBeHidden();

    const rows = await page.locator('.hero-trust:visible').evaluate((el) => {
      const tops = [...el.children].map((c) => Math.round(c.getBoundingClientRect().top));
      return new Set(tops).size;
    });
    expect(rows, 'the four chips must fit in two rows').toBeLessThanOrEqual(2);

    // Equal cells are the whole point of the panel layout — pills that each
    // size to their own label are what made this block read as scattered.
    const widths = await page.locator('.hero-trust:visible').evaluate((el) =>
      [...el.children].map((c) => Math.round(c.getBoundingClientRect().width)));
    expect(new Set(widths).size, `cells must be uniform, got ${widths}`).toBe(1);

    // Each claim on its own line — a wrapped label is what the shortened strings
    // exist to prevent, and it reintroduces the ragged look at 360px. Measured
    // on the label, not the row: the icon disc is taller than one line of text.
    const wrapped = await page.locator('.hero-trust:visible').evaluate((el) =>
      [...el.children].map((c) => {
        const label = c.lastElementChild;
        return Math.round(label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight));
      }));
    expect(Math.max(...wrapped), `every claim must be one line, got ${wrapped}`).toBe(1);

    const vh = page.viewportSize().height;
    const box = await page.locator('.hero-trust:visible').boundingBox();
    expect(box.y + box.height, 'all four chips belong inside the fold').toBeLessThan(vh);
  });

  test('Featured sits above Browse-by-type, which sits above the headline stats', async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator('.property-card').first()).toBeVisible();
    const y = await page.evaluate(() => {
      const top = (sel) => {
        const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().height > 0);
        return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
      };
      return { featured: top('.property-card'), category: top('.cat-card'), trust: top('.hero-trust'), stats: top('.hero-stats') };
    });
    expect(y.featured).not.toBeNull();
    expect(y.trust, 'the proof chips lead the page').toBeLessThan(y.featured);
    expect(y.category, 'Browse by type belongs below Featured').toBeGreaterThan(y.featured);
    expect(y.stats, 'the headline stats belong below both').toBeGreaterThan(y.category);
  });

  test('exactly one copy of the trust chips and stats is exposed', async ({ page }) => {
    // The hero and the mobile proof strip render the same component; both being
    // visible would duplicate them in the accessibility tree.
    await gotoHome(page);
    await expect(page.locator('.hero-trust:visible')).toHaveCount(1);
    await expect(page.locator('.hero-stats:visible')).toHaveCount(1);
  });

  test('the vertical rhythm is standardised, not four different gaps', async ({ page }) => {
    // Every section heading used to pick its own bottom margin (mb-3/6/8/10) and
    // the tokenised section gap was authored for a 1440px canvas. On a phone that
    // is most of a fold spent on air. Both now come from two variables.
    await gotoHome(page);
    const r = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const heads = [...document.querySelectorAll('.section-head')]
        .filter((e) => e.getBoundingClientRect().height > 0)
        .map((e) => Math.round(parseFloat(getComputedStyle(e).marginBottom)));
      return {
        gap: cs.getPropertyValue('--section-gap').trim(),
        headGap: cs.getPropertyValue('--section-head-gap').trim(),
        heads,
      };
    });
    expect(r.gap).toBe('1.75rem');
    expect(r.headGap).toBe('1.25rem');
    expect(r.heads.length, 'the home sections opt into the shared header gap').toBeGreaterThanOrEqual(4);
    expect(new Set(r.heads).size, `every section header shares one gap, got ${r.heads}`).toBe(1);
    expect(r.heads[0]).toBe(20);
  });

  test('the verified-homes proof captions the rail, not the heading', async ({ page }) => {
    // It is inventory proof, so it belongs against the stock it describes. Sitting
    // under the heading it read as a second subtitle and pushed the first card down.
    await gotoHome(page);
    await page.waitForTimeout(1200); // let the list-reveal transform settle
    const r = await page.evaluate(() => {
      const rect = (el) => el.getBoundingClientRect();
      const h2 = [...document.querySelectorAll('h2')].find((e) => /featured/i.test(e.textContent));
      const proof = [...document.querySelectorAll('p')]
        .find((e) => /shield-check|verified/i.test(e.className + e.textContent) && rect(e).height > 0 && e.querySelector('svg'));
      const card = document.querySelector('.property-card');
      return {
        found: !!proof,
        headingToProof: Math.round(rect(proof).top - rect(h2).bottom),
        proofToCard: Math.round(rect(card).top - rect(proof).bottom),
      };
    });
    expect(r.found, 'the verified-homes line is rendered on mobile').toBe(true);
    // Tighter to the tiles below than it is loose from the heading above, and
    // both small enough to read as one block rather than three stacked ones.
    expect(r.headingToProof, 'heading sits close above the proof line').toBeLessThanOrEqual(12);
    expect(r.proofToCard, 'the proof line captions the first tile').toBeLessThanOrEqual(12);
    expect(r.proofToCard).toBeGreaterThan(0);
  });

  test('no unresolved i18n keys are rendered as copy', async ({ page }) => {
    // i18next renders a missing key as the key itself, so a rename that moves the
    // JSX but not the JSON ships silently — that is how "home.flatmates.badge"
    // became visible copy in the Flatmates section. The static half of this guard
    // is `npm run check:i18n`; this catches the interpolated keys it cannot see.
    await gotoHome(page);
    const leaked = await page.evaluate(() => {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const s = n.nodeValue.trim();
        if (/^[a-z][\w]*(\.[\w]+){2,}$/.test(s)) out.push(s);
      }
      return out;
    });
    expect(leaked, `unresolved i18n keys on screen: ${leaked}`).toEqual([]);
  });

  test('the first featured image is not lazy', async ({ page }) => {
    // Above the fold, loading="lazy" defers the one image the first impression
    // rests on.
    await gotoHome(page);
    const img = page.locator('.property-card img').first();
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('loading', 'eager');
  });
});
