/* Responsive listing images.
 *
 * A 360px phone on 4G should not download the same JPEG a 1440px desktop gets.
 * Listing photos are served from an image host that takes the target width as a
 * `w=` query parameter, so a srcset is just the same URL re-stamped at several
 * widths — no new assets, no build step.
 *
 * Deliberately conservative: if a URL has no `w=` parameter we can't safely
 * assume the host will resize, so we return `undefined` and the caller falls
 * back to a plain `src`. That keeps this a pure enhancement — it can never
 * produce a broken image.
 */

const DEFAULT_WIDTHS = [320, 480, 640, 960];

/**
 * Build a `srcset` for an image URL that carries a `w=` width parameter.
 * @param {string} url - Source image URL.
 * @param {number[]} [widths] - Candidate widths, ascending.
 * @returns {string|undefined} A srcset string, or undefined if not resizable.
 */
export function srcSetFor(url, widths = DEFAULT_WIDTHS) {
  if (typeof url !== 'string' || !url) return undefined;
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return undefined;

  const base = url.slice(0, qIdx);
  let params;
  try {
    params = new URLSearchParams(url.slice(qIdx + 1));
  } catch {
    return undefined;
  }
  if (!params.has('w')) return undefined;

  return widths
    .map((w) => {
      const next = new URLSearchParams(params);
      next.set('w', String(w));
      return `${base}?${next.toString()} ${w}w`;
    })
    .join(', ');
}

/**
 * The `sizes` hint for a card image in a responsive grid: full-bleed minus the
 * page gutter on phones, then progressively narrower as columns are added.
 */
export const CARD_SIZES = '(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) 45vw, 320px';
