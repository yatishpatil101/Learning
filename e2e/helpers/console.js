// Console / page-error tracking shared across specs.
//
// The app loads third-party assets (map tiles, CDN images, favicon) that emit
// console noise unrelated to app behaviour. `IGNORE` filters that out so a spec
// can assert "zero real console errors".

export const IGNORE =
  /favicon|leaflet|unpkg|tile\.openstreetmap|openstreetmap|maps\.googleapis|unsplash|cdn|ERR_INTERNET|ERR_NETWORK|net::ERR|Failed to load resource/i;

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
