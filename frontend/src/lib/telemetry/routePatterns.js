/**
 * Route patterns, and the reducer from a real URL to one of them: telemetry stores the page class,
 * never the pathname, so `page_views` cannot become a browsing history.
 */
import { matchRoutes } from 'react-router';

/**
 * Recorded when a URL matches no route. Kept as a real bucket rather than dropped: a spike here is
 * a broken link, which a traffic report could not otherwise tell you.
 */
export const UNMATCHED = '/*';

/**
 * Every `path` declared in `App.jsx`, minus the `*` catch-all, which {@link UNMATCHED} represents.
 * Order is irrelevant (`matchRoutes` ranks by specificity); alphabetical for diffability.
 */
export const ROUTE_PATTERNS = [
  '/',
  '/admin',
  '/admin/analytics',
  '/admin/content',
  '/admin/enquiries',
  '/admin/finance',
  '/admin/flatmates',
  '/admin/kyc-review',
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
  '/disclaimer',
  '/docs',
  '/emi-calculator',
  '/flatmates',

  /*
   * The help centre, registered once per language so each has its own indexable URL. Kept as
   * eighteen entries: collapsing the prefixes would destroy per-language readership permanently.
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
  '/ops/kyc-review',
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
  '/verify-identity',
  '/view-documents/:requestId',
];

/** Shaped for `matchRoutes`, which wants route objects rather than bare strings. */
const ROUTE_OBJECTS = ROUTE_PATTERNS.map((path) => ({ path }));

/**
 * True for the back-office surfaces, whose page views are never collected: staff would top the
 * visitor chart, and storing then filtering would leave a staff activity log in an open table.
 */
export const isBackOffice = (pattern) =>
  pattern === '/admin' || pattern === '/ops'
  || pattern.startsWith('/admin/') || pattern.startsWith('/ops/');

/**
 * @param {string} pathname `location.pathname`, without search or hash
 * @returns {string} a member of {@link ROUTE_PATTERNS}, or {@link UNMATCHED}
 */
export function toRoutePattern(pathname) {
  const matches = matchRoutes(ROUTE_OBJECTS, { pathname: pathname || '/' });
  // `matchRoutes` returns the branch root-first; the last entry is the leaf that actually rendered.
  const leaf = matches?.[matches.length - 1];
  return leaf?.route?.path || UNMATCHED;
}
