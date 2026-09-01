/**
 * The app's route patterns, and the function that reduces a real URL to one of them.
 *
 * ## Why telemetry stores a pattern and never a pathname
 *
 * `/property/kothrud-3bhk-lakeview-9f2c` identifies a specific listing that a specific person was
 * looking at. `/property/:id` says somebody looked at a listing. Only the second is a page-views
 * chart; the first is a browsing history, and storing it would make `page_views` a table whose
 * rows describe individuals — the exact thing its migration says it is not. Every report this feeds
 * groups by page *class*, so the identifying half of the URL is not merely risky to keep, it is
 * unused.
 *
 * ## Why this list exists rather than a heuristic
 *
 * The obvious shortcut is to generalise structurally — treat any slug-shaped segment as a
 * parameter. It cannot work here: `/services/packers-movers` is a real static page and
 * `/property/kothrud-3bhk` is a listing, and nothing about the two strings distinguishes them. A
 * heuristic would either collapse six genuine service pages into one bucket or preserve every
 * listing slug, and it would do whichever silently. So the patterns are enumerated.
 *
 * ## Why the list cannot drift
 *
 * An enumerated list duplicates `App.jsx`, and a duplicate that nobody checks is a duplicate that
 * is wrong within a month — a route added later would fall through to `UNMATCHED` and its traffic
 * would vanish into a bucket nobody reads, with no error anywhere. `scripts/check-route-patterns.mjs`
 * parses the `path=` literals out of `App.jsx` and fails `npm run check` when the two sets differ,
 * which turns that silent data loss into a build failure. Add a route, add it here.
 */
import { matchRoutes } from 'react-router';

/**
 * Recorded when a URL matches no route — i.e. the 404 page.
 *
 * Kept as a real bucket rather than dropped: a spike here is a broken link somewhere, and it is
 * one of the few things a traffic report can tell you that you would not otherwise learn.
 */
export const UNMATCHED = '/*';

/**
 * Every `path` declared in `App.jsx`, minus the `*` catch-all, which {@link UNMATCHED} represents.
 *
 * Order is irrelevant — `matchRoutes` ranks by specificity, so `/services/packers-movers` wins over
 * `/services` regardless of position. Kept alphabetical for diffability against the check script.
 */
export const ROUTE_PATTERNS = [
  '/',
  '/admin',
  '/admin/analytics',
  '/admin/content',
  '/admin/enquiries',
  '/admin/finance',
  '/admin/flatmates',
  '/admin/localities',
  '/admin/post-on-behalf',
  '/admin/properties',
  '/admin/reports',
  '/admin/services',
  '/admin/settings',
  '/admin/societies',
  '/admin/staff-activity',
  '/admin/support',
  '/admin/team',
  '/admin/users',
  '/checkout',
  '/compare',
  '/contact',
  '/dashboard',
  '/dev-seed',
  '/disclaimer',
  '/docs',
  '/emi-calculator',
  '/flatmates',

  /*
   * The help centre, registered once per language so each has its own indexable URL — see the
   * prefix map block in App.jsx, which repeats the same six routes under no prefix, /hi and /mr.
   *
   * Kept as eighteen entries rather than folded into six, because "did anyone read the Marathi
   * articles?" is one of the few questions this data can answer that nothing else can, and
   * collapsing the prefixes would destroy the answer at collection time, permanently.
   *
   * All eighteen were missing when scripts/check-route-patterns.mjs was first run: the entire
   * public help centre was being recorded as 404 traffic. That is precisely the silent failure the
   * script exists to make loud.
   */
  '/help',
  '/help/a/:slug',
  '/help/c/:categoryId',
  '/help/changelog',
  '/help/faq',
  '/help/search',
  '/hi/help',
  '/hi/help/a/:slug',
  '/hi/help/c/:categoryId',
  '/hi/help/changelog',
  '/hi/help/faq',
  '/hi/help/search',
  '/mr/help',
  '/mr/help/a/:slug',
  '/mr/help/c/:categoryId',
  '/mr/help/changelog',
  '/mr/help/faq',
  '/mr/help/search',

  '/help-center',
  '/home-loans',
  '/list-property',
  '/listings',
  '/locality',
  '/locality/:slug',
  '/map',
  '/messages',
  '/notifications',
  '/ops',
  '/ops/drafting-desk',
  '/ops/flatmate-review',
  '/ops/interior',
  '/ops/legal',
  '/ops/packers',
  '/ops/referrals',
  '/ops/rent-agreement',
  '/ops/requests',
  '/ops/support',
  '/ops/valuation',
  '/owner-hub',
  '/owner-hub/property/:id',
  '/owner/:id',
  '/pay-rent',
  '/plans',
  '/privacy',
  '/property/:id',
  '/reels',
  '/refer',
  '/refund-policy',
  '/saved',
  '/schedule-visit',
  '/services',
  '/services/interior-renovation',
  '/services/packers-movers',
  '/services/property-legal',
  '/services/property-valuation',
  '/services/rent-agreement',
  '/share-flat',
  '/shared-documents',
  '/signin',
  '/signup',
  '/societies',
  '/society',
  '/society/:slug',
  '/staff-login',
  '/support',
  '/tenant-profile',
  '/terms',
  '/view-documents/:requestId',
];

/** Shaped for `matchRoutes`, which wants route objects rather than bare strings. */
const ROUTE_OBJECTS = ROUTE_PATTERNS.map((path) => ({ path }));

/**
 * True for the back-office surfaces, whose page views are deliberately never collected.
 *
 * A traffic report is about the platform's visitors. Staff spend their working day in `/admin` and
 * `/ops`, so counting them would put the busiest "visitor" on the platform inside the company and
 * hand the top-pages chart to pages the public cannot reach. Filtering at the reader instead would
 * still have stored a per-session record of which moderator opened which queue and when — a staff
 * activity log arriving by accident, in a table with no access controls designed for one.
 */
export const isBackOffice = (pattern) =>
  pattern === '/admin' || pattern === '/ops'
  || pattern.startsWith('/admin/') || pattern.startsWith('/ops/');

/**
 * Reduce a pathname to the route pattern that rendered it.
 *
 * Uses react-router's own matcher, so ranking is identical to the ranking that chose the component
 * — a hand-rolled longest-prefix walk would agree with it right up until it did not, and the
 * disagreement would show up as a page mysteriously reported under its parent.
 *
 * @param {string} pathname `location.pathname`, without search or hash
 * @returns {string} a member of {@link ROUTE_PATTERNS}, or {@link UNMATCHED}
 */
export function toRoutePattern(pathname) {
  const matches = matchRoutes(ROUTE_OBJECTS, { pathname: pathname || '/' });
  // `matchRoutes` returns the branch root-first; the last entry is the leaf that actually rendered.
  const leaf = matches?.[matches.length - 1];
  return leaf?.route?.path || UNMATCHED;
}
