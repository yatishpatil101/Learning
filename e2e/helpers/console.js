// Console / page-error tracking shared across specs.
//
// The app loads third-party assets (map tiles, CDN images, favicon) that emit
// console noise unrelated to app behaviour. `IGNORE` filters that out so a spec
// can assert "zero real console errors".

/* This list is the **union** of every hand-rolled copy that used to live in the
   specs (tech-debt D96). Consolidating without merging would have been the
   dangerous half of that cleanup: the local lists were not all subsets, so
   deleting them and pointing everything here would have silently *tightened*
   several specs and failed them for reasons unrelated to the change. The three
   finance/dashboard copies contributed `gstatic` and the React DevTools banner,
   and `verification-disclaimer` contributed `maptiler`.

   Two locals were deliberately **not** adopted: bare `ERR_` and bare `maps`.
   Both are broad enough to swallow a real application error that merely happens
   to contain the substring, which is the opposite and worse failure — a filter
   that hides the bug it was meant to let you see. `net::ERR` plus the explicit
   `ERR_INTERNET`/`ERR_NETWORK` cover the actual network cases. */
export const IGNORE =
  /favicon|leaflet|unpkg|tile\.|openstreetmap|maptiler|googleapis|gstatic|unsplash|cdn|ERR_INTERNET|ERR_NETWORK|net::ERR|Failed to load resource|React DevTools/i;

/**
 * Start collecting real (non-noise) console errors + uncaught page errors.
 * @param {import('@playwright/test').Page} page
 * @returns {string[]} live array that fills as the page runs.
 */
export function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text());
  });
  return errors;
}
