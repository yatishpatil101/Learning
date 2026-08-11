/* The 12px legibility floor (D134).
 *
 * WHY THIS IS A POSTCSS PLUGIN AND NOT A DIFF
 * ------------------------------------------
 * The floor was scheduled twice as "edit every undersized class" and dropped
 * both times, because the surface is not the ~40 files the register guessed:
 * a sweep of `text-[Npx]` / `font-size: Npx` under 12px finds 697 occurrences
 * across 182 files. A diff that size is unreviewable, it collides with every
 * other lane touching the same components, and — worse — it does not actually
 * hold. Nothing stops the 698th `text-[11px]` landing next week.
 *
 * A floor has to be enforced by the build, in one place, or it is a style
 * suggestion. This plugin runs after Tailwind has expanded its utilities, so it
 * sees BOTH hand-written CSS and the arbitrary-value classes (`text-[11px]`)
 * that Tailwind generates on demand — the two ways sub-12px text enters this
 * codebase. Nothing else has to change, and a new `text-[10px]` written
 * tomorrow is floored the moment it is compiled.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * There is no exemption list here. An escape hatch at the build layer would be
 * invisible in review (one comment on one declaration, in a 3,500-line
 * stylesheet) and would grow until the floor meant nothing. The only exemptions
 * that exist are in `e2e/tests/mobile/text-legibility.spec.js`, where they are
 * a short constant array that a reviewer reads in one screen.
 *
 * It also only raises; it never lowers. `font-size: 24px` is left alone.
 *
 * UNITS: px and rem are resolved and floored, each keeping the unit it was written
 * in — see `floorValue`, and do not "simplify" it back to px. Relative units (em,
 * %, ex, ch) and any expression (clamp/calc/var) are left alone on purpose — their
 * computed value depends on an ancestor this plugin cannot see, so "raising" them
 * here would be a guess. Those are exactly the cases the runtime sweep exists to
 * catch, because it measures the *computed* size in a real browser.
 */

/** The floor, in CSS px. WCAG has no hard minimum; 12px is the smallest size
 *  this product's own design system already treats as body-legible on a phone. */
export const MIN_FONT_PX = 12;

/** Browser default root size. Tailwind's rem scale assumes the same. */
const ROOT_PX = 16;

const ABSOLUTE = /^\s*(-?\d*\.?\d+)(px|rem)\s*$/;

/** Absolute length -> { px, unit }, or null when the value is relative/computed. */
function measure(value) {
  const m = ABSOLUTE.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2];
  return { px: unit === 'rem' ? n * ROOT_PX : n, unit };
}

/* Raise to the floor IN THE UNIT THE AUTHOR WROTE.
 *
 * Rewriting a rem to px is not a neutral re-spelling: a rem font-size tracks the
 * browser/OS font-size setting and a px one is frozen against it. Flooring
 * `.pn-bottom-nav__label { font-size: 0.6875rem }` to `12px` therefore fixed a
 * legibility bug by introducing a worse one — the label stopped responding to
 * dynamic type entirely, which is the exact accessibility failure that rule's own
 * comment was written to prevent. `mobile/landscape.spec.js` caught it.
 *
 * So px stays px and rem stays rem; only the number moves. */
const floorValue = (unit, min) => (unit === 'rem' ? `${min / ROOT_PX}rem` : `${min}px`);

/** @type {import('postcss').PluginCreator<{ min?: number }>} */
export default function minFontSize({ min = MIN_FONT_PX } = {}) {
  return {
    postcssPlugin: 'punenest-min-font-size',
    Declaration: {
      'font-size': (decl) => {
        const m = measure(decl.value);
        if (m === null || m.px >= min) return;
        decl.value = floorValue(m.unit, min);
      },
    },
  };
}

minFontSize.postcss = true;
