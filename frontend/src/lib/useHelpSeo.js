/* Head management for the help centre.
 *
 * The app has no SSR, so these tags are written into the live document rather
 * than rendered server-side. Search engines execute JS, so this works — but it
 * is worth being explicit that a prerender or SSR step would make the help
 * centre index far more reliably, and this is the seam where that would plug in.
 *
 * Three things are managed, all of which are wrong by default in a single-page
 * app that serves three languages from one HTML file:
 *
 *   canonical  Without it, /hi/help/a/x and /help/a/x look like duplicate
 *              content and the crawler picks one arbitrarily.
 *   hreflang   Tells the crawler these URLs are translations of each other, so
 *              a Marathi searcher is served the Marathi URL instead of English.
 *   x-default  Where to send a language we do not publish.
 */

import { useEffect } from 'react';
import { alternateUrls, helpPath } from './helpUrl.js';

const MANAGED = 'data-help-seo';

function upsertLink(rel, href, hreflang) {
  const selector = hreflang
    ? `link[${MANAGED}][rel="${rel}"][hreflang="${hreflang}"]`
    : `link[${MANAGED}][rel="${rel}"]`;
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute(MANAGED, '');
    el.setAttribute('rel', rel);
    if (hreflang) el.setAttribute('hreflang', hreflang);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * Publish canonical + hreflang for a help page.
 *
 * @param {string} path Unprefixed help path, e.g. `/help/a/zero-brokerage`.
 * @param {string} lang Active language.
 * @param {{ index?: boolean }} [opts] Pass `index: false` for staff-only pages.
 */
export function useHelpSeo(path, lang, opts = {}) {
  const index = opts.index !== false;

  useEffect(() => {
    if (typeof document === 'undefined' || !path) return undefined;
    const origin = window.location.origin;

    // Staff runbooks are reachable by URL but must never be indexed — they are
    // internal procedure, and a crawler has no staff session to be filtered by.
    if (!index) {
      let robots = document.head.querySelector(`meta[${MANAGED}][name="robots"]`);
      if (!robots) {
        robots = document.createElement('meta');
        robots.setAttribute(MANAGED, '');
        robots.setAttribute('name', 'robots');
        document.head.appendChild(robots);
      }
      robots.setAttribute('content', 'noindex, nofollow');
    }

    upsertLink('canonical', `${origin}${helpPath(path, lang)}`);
    for (const alt of alternateUrls(path, origin)) upsertLink('alternate', alt.href, alt.lang);
    upsertLink('alternate', `${origin}${helpPath(path, 'en')}`, 'x-default');

    return () => {
      document.head.querySelectorAll(`[${MANAGED}]`).forEach((el) => el.remove());
    };
  }, [path, lang, index]);
}
