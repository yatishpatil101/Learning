/* Language-prefixed URLs for the help centre.
 *
 * The rest of the app is a single-URL SPA: switching language re-renders in
 * place and the address bar never changes. That is fine for signed-in surfaces,
 * but the help centre is public and exists partly to be found in search. One URL
 * serving three languages means a search engine indexes exactly one of them —
 * whichever it happened to render — and the Hindi and Marathi articles are
 * invisible to the people most likely to search in those languages.
 *
 * So help routes carry an optional language prefix:
 *
 *     /help/a/zero-brokerage        English (canonical, unprefixed)
 *     /hi/help/a/zero-brokerage     Hindi
 *     /mr/help/a/zero-brokerage     Marathi
 *
 * English is unprefixed rather than living at /en/ so existing links, the
 * sitemap already in production and any external references keep working.
 *
 * This module is the single place that knows the prefix rule. Components build
 * links with `helpPath()` and never concatenate the prefix themselves — the one
 * failure this prevents is a Marathi reader clicking a link that silently drops
 * them back into English.
 */

/** Languages that get a URL prefix. English is deliberately absent. */
export const PREFIXED_LANGS = ['hi', 'mr'];

/** Every language the help centre is addressable in, canonical first. */
export const HELP_LANGS = ['en', ...PREFIXED_LANGS];

const PREFIX_RE = new RegExp(`^/(${PREFIXED_LANGS.join('|')})(?=/|$)`);

/** Normalise an i18next tag (`mr-IN`, `HI`) to a help language. */
export function normalizeHelpLang(lang) {
  const short = String(lang || 'en').toLowerCase().split('-')[0];
  return HELP_LANGS.includes(short) ? short : 'en';
}

/**
 * Split a pathname into its language prefix and the rest.
 *
 * @param {string} pathname
 * @returns {{ lang: string, rest: string }} `rest` always starts with `/`.
 */
export function splitLangPrefix(pathname) {
  const path = pathname || '/';
  const match = path.match(PREFIX_RE);
  if (!match) return { lang: 'en', rest: path };
  const rest = path.slice(match[0].length) || '/';
  return { lang: match[1], rest: rest.startsWith('/') ? rest : `/${rest}` };
}

/**
 * Build a help URL in a given language.
 *
 * @param {string} path A help path with no prefix, e.g. `/help/a/zero-brokerage`.
 * @param {string} lang
 */
export function helpPath(path, lang) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const short = normalizeHelpLang(lang);
  return short === 'en' ? clean : `/${short}${clean}`;
}

/**
 * The same page in every language, for hreflang alternates.
 *
 * @param {string} path Unprefixed help path.
 * @param {string} origin Absolute origin, e.g. `https://draazy.com`.
 */
export function alternateUrls(path, origin = '') {
  const base = origin.replace(/\/$/, '');
  return HELP_LANGS.map((lang) => ({
    lang,
    href: `${base}${helpPath(path, lang)}`,
  }));
}
