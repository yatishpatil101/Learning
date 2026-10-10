/* Responsive listing images: the host resizes via the `w=` param, so a srcset is the same URL per width.
   Without `w=` nothing is assumed resizable and callers fall back to a plain `src`. */

const DEFAULT_WIDTHS = [320, 480, 640, 960];

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

export const CARD_SIZES = '(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) 45vw, 320px';

// An upload's key as PhotoService writes it (PhotoKeys tag, or a pre-tag owner id); card copies sit beside it.
const UPLOADED_PHOTO = /\/photos\/(?:[0-9a-f]{16}|[0-9a-f-]{36})\/[0-9a-f-]{36}(?:-[0-9a-f]{16})?$/;

/** Card-sized srcset: the server's small copies of an uploaded photo, else a `w=` host's widths. */
export function cardSrcSet(url) {
  if (typeof url === 'string' && UPLOADED_PHOTO.test(url)) {
    return `${url}.w480.jpg 480w, ${url}.w960.jpg 960w`;
  }
  return srcSetFor(url);
}
