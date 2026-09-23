import { test, expect } from '../../fixtures/live.js';

/* A touchscreen synthesises `:hover` and holds it until the next tap lands elsewhere, so every
 * decorative hover must be gated on `(hover: hover)`. Emulation reports a 0 safe-area inset. */

const PROP = 'p5000'; // approved seed listing, same one the density spec uses.

const gotoProp = async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the cookie bar just stays up */ }
  });
  await page.goto(`/property/${PROP}`);
  await page.locator('.main-image-wrapper').first().waitFor({ timeout: 15000 });
};

/* `[]` means the rule exists at top level; `null` means no such rule — the two are different
 *  failures and the assertions below distinguish them. */
const mediaWrapping = (page, selector) =>
  page.evaluate((sel) => {
    const found = [];
    let seen = 0;
    /* Per-rule try/catch, not one around the sheet: a single rule the CSSOM refuses to expose would
       otherwise abandon the remaining few thousand and report "no such rule". */
    const walk = (rules, conditions) => {
      for (const rule of rules) {
        seen += 1;
        try {
          const conds = rule.type === CSSRule.MEDIA_RULE ? [...conditions, rule.conditionText] : conditions;
          /* Match BEFORE recursing, and recurse unconditionally: since CSS Nesting, a plain style
             rule also carries an empty `cssRules`, so an `else if` branch swallows every rule. */
          if (rule.selectorText && rule.selectorText.split(',').some((s) => s.trim() === sel)) found.push(conds);
          if (rule.cssRules) walk(rule.cssRules, conds);
        } catch { /* one unreadable rule, e.g. an imported cross-origin sheet */ }
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules, []); } catch { /* cross-origin sheet — none of ours */ }
    }
    return { found, seen };
  }, selector);

test.describe('Property detail — sticky hover', () => {
  /* Hand-written rules only: Tailwind's `hover:` utilities need no entry, because
     `future.hoverOnlyWhenSupported` already emits them inside this same query. */
  const GATED = [
    '.detail-card:hover',
    '.amenity-card:hover',
    '.highlight-pill:hover',
    '.rd-cell:hover',
    '.icon-btn:hover',
    '.tag:hover',
    '.tag-strip .tag:hover',
    '.pick:hover',
    '.thumbnail:hover',
    '.thumbnail:hover img',
    '.main-image-wrapper:hover img',
    '.dz-detail-tab:hover',
    '.dz-modal-x:hover',
    '.dz-lb-close:hover',
    '.dz-lb-nav:hover',
  ];

  /* The rest of the lift-on-hover family, on pages this spec never opens — they ship in the same
     global sheet, so the CSSOM here proves they are gated without paying for their routes. */
  const GLOBAL_GATED = ['.prop-row:hover', '.prop-row:hover img', '.svc:hover', '.tile:hover'];

  test('every decorative hover is gated on a pointer that can leave', async ({ page }) => {
    await gotoProp(page);

    for (const selector of [...GATED, ...GLOBAL_GATED]) {
      const { found, seen } = await mediaWrapping(page, selector);
      expect(seen, 'the walk reached no CSS rules at all, so every assertion below would pass or fail for the wrong reason').toBeGreaterThan(100);
      expect(found.length, `${selector} has no rule at all — it was renamed or deleted, and this guard now proves nothing`).toBeGreaterThan(0);
      const gated = found.some((conds) => conds.some((c) => c.replace(/\s/g, '').includes('hover:hover')));
      expect(gated, `${selector} applies on a touchscreen, where the state it paints cannot be cleared`).toBe(true);
    }
  });

  /* The rule above is about the stylesheet; this one is about the finger. It would still
     pass if a future hover were written as an inline style or a JS class toggle. */
  test('touching a tile leaves no state behind', async ({ page }) => {
    await gotoProp(page);
    expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches),
      'the mobile projects must emulate a touchscreen, or the gate under test is inactive and this passes vacuously').toBe(false);

    const tile = page.locator('.detail-card').first();
    await expect(tile).toBeVisible();
    const paint = () => tile.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.backgroundColor} ${s.borderColor}`;
    });

    const before = await paint();
    await tile.hover();
    expect(await paint(), 'the tile changed colour under a pointer that cannot move away again').toBe(before);
  });
});

test.describe('Property detail — photo lightbox', () => {
  const openLightbox = async (page) => {
    await gotoProp(page);
    await page.locator('.main-image-wrapper img').first().click();
    const lb = page.locator('.dz-lightbox');
    await expect(lb).toBeVisible();
    return lb;
  };

  test('the overlay owns the gesture instead of dragging the page behind it', async ({ page }) => {
    const lb = await openLightbox(page);

    const m = await lb.evaluate((el) => {
      const s = getComputedStyle(el);
      return { overlay: s.touchAction, photo: getComputedStyle(el.querySelector('img')).touchAction };
    });
    // Claiming the gesture stops the photo's 40px swipe threshold from also panning the listing,
    // and stops a downward swipe firing pull-to-refresh. `overscroll-behavior` would be inert here.
    expect(m.overlay, 'the photo swipe must not also pan the listing behind it').toBe('none');
    // Re-opened on the image alone, because the same class carries the floor-plan zoom, whose
    // entire purpose is to be enlarged. Pinch only — single-finger pan stays claimed above.
    expect(m.photo, 'the floor plan must still be pinch-zoomable to read room dimensions').toBe('pinch-zoom');
  });

  test('the arrows give way to the swipe that already works', async ({ page }) => {
    const lb = await openLightbox(page);
    // Two 48px arrows either side of a full-width photo do not fit a 390px screen, and the
    // <img> has carried its own swipe handler since before they were hidden.
    await expect(lb.locator('.dz-lb-nav')).toHaveCount(2);
    await expect(lb.locator('.dz-lb-nav').first()).toBeHidden();
  });

  test('the photo is measured against the visible viewport, and the close button clears the notch', async ({ page }) => {
    await openLightbox(page);

    /* Declared values, not computed ones: see the file header — emulation reports a 0px
       inset and resolves dvh as vh, so both fixes are invisible to a computed style. */
    const declared = await page.evaluate(() => {
      const out = {};
      const walk = (rules) => {
        for (const rule of rules) {
          // Match first, recurse second — see `mediaWrapping` on CSS Nesting's empty `cssRules`.
          if (rule.selectorText === '.dz-lightbox img') out.img = rule.style.maxHeight;
          else if (rule.selectorText === '.dz-lightbox') out.pad = rule.style.padding;
          else if (rule.selectorText === '.dz-lb-close') out.close = `${rule.style.top} ${rule.style.right}`;
          if (rule.cssRules) walk(rule.cssRules);
        }
      };
      for (const sheet of document.styleSheets) {
        try { walk(sheet.cssRules); } catch { /* cross-origin sheet — none of ours */ }
      }
      return out;
    });

    // `vh` is the URL-bar-collapsed viewport, so on iOS Safari an 82vh photo is taller
    // than the space it has and its own caption is pushed off the bottom.
    expect(declared.img, 'the photo must be sized against the viewport the user can see').toContain('dvh');
    expect(declared.pad, 'the overlay must inset itself from the notch and the home indicator').toContain('safe-area-inset-top');
    /* The close button is absolutely positioned, so it resolves against the container's
       PADDING box and the inset above does not move it — it needs its own. */
    expect(declared.close, 'an absolutely positioned close button sits under the notch unless it insets itself').toContain('safe-area-inset-top');
  });
});

/* These assert the SEAM, not the feel: that the hero really is a snapping scroll container, that a
 * scroll commits to `active`, and that `active` moving from elsewhere still drags the track. */
test.describe('Property detail — hero carousel', () => {
  const track = (page) => page.locator('[data-gallery-track]');
  const dots = (page) => page.locator('[data-gallery-dots] button');
  const lit = (page) => page.locator('[data-gallery-dots] [aria-current="true"]');

  test('the hero is a real scroll container, and it snaps', async ({ page }) => {
    await gotoProp(page);

    const m = await track(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { overflowX: s.overflowX, snap: s.scrollSnapType, overscrollX: s.overscrollBehaviorX };
    });
    // `auto`, not `hidden`: the whole point is that the finger drives the scroller directly.
    expect(m.overflowX, 'the hero must be scrollable by the finger, not by a JS threshold').toBe('auto');
    // Mandatory, so a settled scrollLeft is always an exact multiple of the slide width — the
    // rounding in the scroll handler depends on it.
    expect(m.snap, 'without mandatory snapping the hero rests between two photos').toContain('mandatory');
    expect(m.snap, 'the hero snaps along the axis it scrolls').toContain('x');
    // A swipe past the last photo must not hand the gesture to the page behind it.
    expect(m.overscrollX, 'overscrolling the last photo must not scroll the listing').toBe('contain');
  });

  test('scrolling the hero commits to the selected dot once it settles', async ({ page }) => {
    await gotoProp(page);
    const d = dots(page);
    /* Fewer than two photos and every assertion below passes for the wrong reason: there would
       be nothing to scroll to. The seed listing carries a gallery; this guards the fixture. */
    expect(await d.count(), 'this fixture has no second photo, so the swipe under test cannot happen').toBeGreaterThan(2);
    await expect(d.nth(0)).toHaveAttribute('aria-current', 'true');

    await track(page).evaluate((el) => el.scrollTo({ left: el.clientWidth, behavior: 'auto' }));

    /* Auto-retrying assertions, deliberately: the handler commits on a 120ms settle timer, because
       committing mid-drag re-enters the effect that syncs the track and yanks it from the finger. */
    await expect(page.locator('.main-image-wrapper').first(), 'a settled scroll must commit the photo').toContainText('2/');
    await expect(d.nth(1), 'the second photo owns the second dot').toHaveAttribute('aria-current', 'true');
    await expect(lit(page), 'exactly one dot may be lit at a time').toHaveCount(1);
  });

  test('the last photo still lights its own dot', async ({ page }) => {
    await gotoProp(page);
    const d = dots(page);
    const n = await d.count();

    /* Checked at the end, where an off-by-one shows. Children are the photos plus the ask slide,
       so the last photo is at -2. */
    await track(page).evaluate((el) => el.scrollTo({ left: el.clientWidth * (el.children.length - 2), behavior: 'auto' }));

    await expect(lit(page), 'the last photo must still light a dot').toHaveCount(1);
    await expect(d.nth(n - 2), 'the last photo owns the last photo dot').toHaveAttribute('aria-current', 'true');
  });

  test('tapping a dot drags the track to that photo', async ({ page }) => {
    await gotoProp(page);
    /* The reverse direction of the same seam: the dots, thumbnails, desktop arrows and lightbox all
       move `active` without touching the scroller, so the track has to follow it. */
    const d = dots(page);
    const n = await d.count();
    expect(n, 'this fixture has too few photos for the rail to move anywhere').toBeGreaterThan(3);

    /* The LAST photo dot rather than an arbitrary one, so the test does not depend on how many
       photos the fixture carries. The trailing dot is the ask card, hence -2. */
    const lastPhoto = await track(page).evaluate((el) => el.children.length - 2);
    await d.nth(n - 2).click();

    await expect
      .poll(async () => track(page).evaluate((el) => Math.round(el.scrollLeft / el.clientWidth)), {
        message: 'moving `active` from outside the scroller must still move the photo',
      })
      .toBe(lastPhoto);
  });

  test('the request-photos card is the last slide, and nothing lies past it', async ({ page }) => {
    await gotoProp(page);
    const ask = page.locator('[data-photo-ask]');

    // It is a slide now rather than an overlay, so it has to be the terminus — a slide after it
    // would be a photo the ask card hides.
    expect(await ask.evaluate((el) => el === el.parentElement.lastElementChild), 'the ask card must be the last slide').toBe(true);

    await track(page).evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'auto' }));
    await expect(ask).toBeInViewport();
    await expect(dots(page).last(), 'the trailing dot marks the ask card, not a photo').toHaveAttribute('aria-current', 'true');
  });

  test('above the phone breakpoint the arrows drive the track, not the finger', async ({ page }) => {
    /* Widened inside the mobile project on purpose: the claim is about the BREAKPOINT, not the
       pointer. The regression this guards is desktop silently gaining a horizontal scrollbar. */
    await gotoProp(page);
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.locator('button.thumbnail').first()).toBeVisible();

    const overflowX = await track(page).evaluate((el) => getComputedStyle(el).overflowX);
    expect(overflowX, 'the desktop hero must not become a second horizontal scrollbar').toBe('hidden');
  });
});
