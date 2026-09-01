import { test, expect } from '../../../fixtures/live.js';

/* Service-landing hero image (frontend/src/components/ServiceLanding.jsx).
 *
 * The hero used to be a CSS background, where a srcset has no effect at all; it
 * is now a real `<img>` with a four-rung candidate ladder, so a phone fetches
 * ~640w instead of the full 1600w asset.
 *
 * This was previously written off on the grounds that `srcset` cannot be
 * asserted. Half of that is true and is respected here: *which candidate the
 * browser downloads* is the browser's decision, depends on DPR, viewport, network
 * and Chromium's own heuristics, and is asserted nowhere below. *Which attributes
 * our component renders* is entirely our code, and it is the thing that actually
 * breaks — a dropped `sizes` silently makes the ladder useless, and a dropped
 * width/height silently reintroduces the layout shift the intrinsic size exists
 * to prevent.
 *
 * All three callers are covered because the widths live in ServiceLanding, not in
 * the pages, so a regression there lands on every service landing at once.
 */

/* The real routes — two are nested under /services, one is not. */
const LANDINGS = [
  { name: 'packers & movers', path: '/services/packers-movers' },
  { name: 'home loans', path: '/home-loans' },
  { name: 'property legal', path: '/services/property-legal' },
];

/* HERO_WIDTHS in ServiceLanding.jsx. Wider than imgSrcSet's card default (which
   tops out at 960w) because the hero is full-bleed; the top rung matches the
   1600px source every caller passes, so desktop quality is unchanged. */
const HERO_WIDTHS = [640, 960, 1280, 1600];

/** Parse a `srcset` into `[{ url, descriptor }]`, splitting only on the commas between candidates. */
function parseSrcSet(srcset) {
  return srcset
    .split(/,\s*(?=https?:)/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const gap = entry.lastIndexOf(' ');
      return { url: entry.slice(0, gap), descriptor: entry.slice(gap + 1) };
    });
}

for (const { name, path } of LANDINGS) {
  test.describe(`Service landing hero — ${name}`, () => {
    test('is a real <img> carrying the full responsive contract', async ({ page, consoleErrors }) => {
      await page.goto(path);

      /* The hero is the section that owns the <h1>. That relationship is the whole
         justification for the image's empty alt: it is decorative because the
         headline directly above it already states the subject. */
      const hero = page.locator('section').filter({ has: page.locator('h1') }).first();
      await expect(hero.locator('h1')).toBeVisible();
      expect((await hero.locator('h1').innerText()).trim()).not.toBe('');

      const img = hero.locator('img');
      await expect(img, 'exactly one hero image, and it is an <img> not a background div').toHaveCount(1);

      const src = await img.getAttribute('src');
      expect(src, 'the hero still has a plain src to fall back to').toBeTruthy();

      // --- the candidate ladder -------------------------------------------------
      const srcset = await img.getAttribute('srcset');
      expect(srcset, 'srcset is rendered (srcSetFor returns undefined for a URL with no w= param)').toBeTruthy();

      const candidates = parseSrcSet(srcset);
      expect(candidates.map((c) => c.descriptor)).toEqual(HERO_WIDTHS.map((w) => `${w}w`));

      const base = (url) => url.split('?')[0];
      for (const [i, candidate] of candidates.entries()) {
        const width = HERO_WIDTHS[i];
        // Same asset, re-stamped at another width — no new files, no build step.
        expect(base(candidate.url), `candidate ${width}w points at the hero asset`).toBe(base(src));
        const params = new URLSearchParams(candidate.url.split('?')[1] || '');
        expect(params.get('w'), `candidate ${width}w asks the image host for ${width}px`).toBe(String(width));
        // Every other query parameter the page passed (quality, format) survives.
        expect(params.get('q')).toBe(new URLSearchParams(src.split('?')[1] || '').get('q'));
      }

      // --- the hints that make the ladder usable --------------------------------
      // Without `sizes`, the browser assumes 100vw anyway for a full-bleed image on
      // some engines and guesses on others — stating it is what makes the choice
      // deterministic. The hero is genuinely full-bleed.
      await expect(img).toHaveAttribute('sizes', '100vw');
      // It is the LCP candidate on every one of these pages.
      await expect(img).toHaveAttribute('fetchpriority', 'high');
      await expect(img).toHaveAttribute('decoding', 'async');

      // --- the anti-layout-shift guarantee --------------------------------------
      // Intrinsic size lets the browser reserve the box before a byte arrives.
      // Dropping these is invisible in review and shows up as CLS in the field.
      await expect(img).toHaveAttribute('width', '1600');
      await expect(img).toHaveAttribute('height', '900');

      // --- decorative, and cropped like the background it replaced --------------
      await expect(img).toHaveAttribute('alt', '');
      const cls = (await img.getAttribute('class')) || '';
      expect(cls, 'object-cover/object-center reproduce the old bg-cover bg-center exactly').toContain('object-cover');
      expect(cls).toContain('object-center');

      /* Deliberately NOT asserted: `img.currentSrc`. Which rung the browser picks
         is its decision, not ours — asserting it would make this spec fail on a
         DPR or network change that is not a regression in our code. */

      expect(consoleErrors).toEqual([]);
    });
  });
}
