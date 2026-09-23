import { test, expect } from '../../fixtures/live.js';
import { seedConsent } from '../../helpers/liveAuth.js';

/* Headless Chromium reports every `env(safe-area-inset-*)` as 0 and cannot force `:active`, so the
 * notch and press-feedback fixes are asserted against the *declared* value through the CSSOM. */

/* Selector-matched rather than element-matched because `:hover` and `:active` rules match no
 *  element at rest, and their absence is exactly what this file is looking for. */
const rulesMentioning = (page, needle) =>
  page.evaluate((n) => {
    const out = [];
    /* Per-rule try/catch, not one around the sheet: a single rule the CSSOM refuses to expose would
       otherwise abandon the remaining few thousand and report an empty result, i.e. a pass. */
    const walk = (rules, media) => {
      for (const r of rules) {
        try {
          if (r.selectorText?.includes(n)) out.push({ selector: r.selectorText, css: r.style.cssText, media });
          if (r.cssRules?.length) walk(r.cssRules, r.media?.mediaText ?? media);
        } catch { /* unexposable rule */ }
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules, ''); } catch { /* cross-origin sheet */ }
    }
    return out;
  }, needle);

async function openFeed(page) {
  await seedConsent(page);
  await page.goto('/reels');
  await expect(page.locator('.reel').first()).toBeVisible({ timeout: 20_000 });
}

test.describe('Reels platform layer', () => {
  test('flicking past the last reel does not rubber-band the page behind the feed', async ({ page }) => {
    await openFeed(page);
    /* The feed is an inner scroller, so the root's own `contain` does not cover it: without this
       the overscroll chains out and exposes the page background under edge-to-edge media. */
    await expect(page.locator('.reel-wrap')).toHaveCSS('overscroll-behavior-y', 'contain');
  });

  test('the intent filter does not stay lit after the finger leaves', async ({ page }) => {
    await openFeed(page);
    const rules = await rulesMentioning(page, '.reels-chip');
    expect(rules.length, 'no .reels-chip rule was exposed at all').toBeGreaterThan(0);

    /* Touch has no hover, so the browser fakes one and leaves it applied until the next tap lands
       elsewhere — an ungated hover style makes an unselected filter read as selected. */
    const ungatedHover = rules.filter((r) => r.selector.includes(':hover') && !r.media.includes('hover: hover'));
    expect(ungatedHover.map((r) => r.selector), 'a hover style a touch device can get stuck in').toEqual([]);

    /* On touch `:active` is the only press state left once the hover rule is gated. Matched on a
       scale factor rather than on the word `transform`, which `transform: none` would satisfy. */
    const active = rules.filter((r) => r.selector.includes(':active') && /transform:\s*scale\(/.test(r.css));
    expect(active.length, 'tapping a filter chip gives no press response').toBeGreaterThan(0);
  });

  test('the filters and the action rail clear a 44px thumb', async ({ page }) => {
    await openFeed(page);
    const chips = page.locator('.reels-chip');
    const chipCount = await chips.count();
    expect(chipCount, 'the intent filters were not rendered').toBe(3);
    for (let i = 0; i < chipCount; i += 1) {
      const box = await chips.nth(i).boundingBox();
      expect(box.height, `filter chip ${i}`).toBeGreaterThanOrEqual(44);
    }

    /* The rail drops its labels and shrinks its icons at `max-height: 700px` — the reason this also
       runs at 360x640. It sits in a media query, which adds no specificity to defend it. */
    const icons = page.locator('.reel').first().locator('.rail .ic');
    const iconCount = await icons.count();
    expect(iconCount, 'the action rail was not rendered').toBe(5);
    for (let i = 0; i < iconCount; i += 1) {
      const box = await icons.nth(i).boundingBox();
      expect(box.height, `rail action ${i}`).toBeGreaterThanOrEqual(44);
      expect(box.width, `rail action ${i}`).toBeGreaterThanOrEqual(44);
    }
  });

  test('the overlays stay clear of the notch when the phone is turned', async ({ page }) => {
    await openFeed(page);
    /* Landscape on a notched phone puts the sensor housing over the side gutters, and
       `viewport-fit=cover` means the page is already under them. Emulation reports a 0 inset. */
    for (const sel of ['.rail', '.reel-info', '.reels-top']) {
      const declared = (await rulesMentioning(page, sel)).map((r) => r.css).join(' ');
      expect(declared, `${sel} has no rule at all`).not.toBe('');
      expect(declared, `${sel} would sit under the sensor housing in landscape`).toContain('safe-area-inset');
    }
  });
});
