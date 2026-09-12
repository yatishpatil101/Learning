/**
 * Human-readable names for the route patterns the page-view reports rank.
 *
 * ## Why this is on the frontend and not in the report
 *
 * The endpoint returns `/property/:id`, and the chart wants "Property detail". That is a rename, not
 * a measurement: it changes with the product's vocabulary, it differs per surface, and it will one
 * day be translated. None of those are reasons to redeploy an API. The server's job ends at "this
 * pattern was viewed 412 times", so the pattern is what it sends.
 *
 * Keeping it here also keeps the stored data self-describing. `page_views.path` holds the pattern
 * forever; if the label lived server-side and someone renamed "Listings" to "Search", every historic
 * row would silently re-label itself, and a year-old screenshot would stop matching the console.
 *
 * ## The fallback is the path, never a guess
 *
 * An unmapped pattern renders as itself — `/help/c/:categoryId` — rather than being prettified by
 * stripping slashes and title-casing. A generated label reads exactly like a curated one, so a
 * missing entry would be invisible; a raw path in a chart axis is visibly unfinished, which is the
 * point. There is deliberately no drift guard here for the same reason: unlike
 * {@link ./routePatterns.js}, a gap in this map loses no data and is self-announcing.
 *
 * Only patterns that can plausibly reach a top-10 list are mapped. Back-office routes are absent
 * because they are never collected at all — see the `/admin*` and `/ops*` exclusion in the
 * collector.
 */

/**
 * Route pattern to display name.
 *
 * The help centre's three language prefixes are named separately and on purpose: "did anyone read
 * the Marathi articles?" is the question those eighteen route entries exist to answer, and folding
 * them into one label in the chart would throw the answer away at the last step.
 */
const PAGE_LABELS = {
  '/': 'Home',
  '/listings': 'Listings',
  '/property/:id': 'Property detail',
  '/flatmates': 'Flatmates',
  '/list-property': 'Post property',
  '/services': 'Services',
  '/locality': 'Locality insights',
  '/locality/:slug': 'Locality detail',
  '/society/:slug': 'Society detail',
  '/emi-calculator': 'EMI calculator',
  '/home-loans': 'Home loans',
  '/map': 'Map search',
  '/compare': 'Compare',
  '/plans': 'Plans & pricing',
  '/dashboard': 'Dashboard',
  '/owner-hub': 'Owner hub',
  '/owner-hub/property/:id': 'Owner hub — property',
  '/owner/:id': 'Owner profile',
  '/pay-rent': 'Pay rent',
  '/checkout': 'Checkout',
  '/messages': 'Messages',
  '/notifications': 'Notifications',
  '/saved': 'Saved',
  '/search': 'Search',
  '/support': 'Support',
  '/contact': 'Contact',
  '/help': 'Help centre',
  '/help/faq': 'Help — FAQ',
  '/help/search': 'Help — search',
  '/help/a/:slug': 'Help — article',
  '/help/c/:categoryId': 'Help — category',
  '/hi/help': 'Help centre (Hindi)',
  '/mr/help': 'Help centre (Marathi)',
  '/help-center': 'Help centre (legacy)',
  '/privacy': 'Privacy policy',
  '/disclaimer': 'Disclaimer',
  '/docs': 'Documents',
  '/*': 'Not found (404)',
};

/**
 * @param {string} path a route pattern as stored by the collector
 * @returns {string} its display name, or the pattern itself when unmapped
 */
export const pageLabel = (path) => PAGE_LABELS[path] || path;
