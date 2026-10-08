/** Route patterns, and the reducer from a real URL to one of them: telemetry stores the page class, never the
 * pathname, so `page_views` cannot become a browsing history. */
import { matchRoutes } from 'react-router';

/** Recorded when a URL matches no route. Kept as a real bucket rather than dropped: a spike here is a broken link,
 * which a traffic report could not otherwise tell you. */
export const UNMATCHED = '/*';

export const ROUTE_PATTERNS = [
  '/',
  '/admin/*',
  '/checkout',
  '/compare',
  '/contact',
  '/dashboard',
  '/disclaimer',
  '/docs',
  '/emi-calculator',
  '/flatmates',
  '/flatmates/:kind/:id',
  '/help',
  '/help/a/:slug',
  '/help/c/:categoryId',
  '/help/changelog',
  '/help/faq',
  '/help/search',
  '/help-center',
  '/hi/help/*',
  '/home-loans',
  '/list-property',
  '/listings',
  '/locality',
  '/locality/:slug',
  '/map',
  '/messages',
  '/mr/help/*',
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
  '/ops/support',
  '/ops/valuation',
  '/ops/*',
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
  '/society/:slug',
  '/staff-invite',
  '/staff/*',
  '/staff-login',
  '/support',
  '/tenant-profile',
  '/terms',
  '/verify-identity',
  '/view-documents/:requestId',
];

/** Shaped for `matchRoutes`, which wants route objects rather than bare strings. */
const ROUTE_OBJECTS = ROUTE_PATTERNS.map((path) => ({ path }));

/** True for the back-office surfaces, whose page views are never collected: staff would top the visitor chart, and
 * storing then filtering would leave a staff activity log in an open table. */
export const isBackOffice = (pattern) =>
  pattern === '/admin' || pattern === '/ops'
  || pattern.startsWith('/admin/') || pattern.startsWith('/ops/') || pattern.startsWith('/staff/');

export function toRoutePattern(pathname) {
  const matches = matchRoutes(ROUTE_OBJECTS, { pathname: pathname || '/' });
  // `matchRoutes` returns the branch root-first; the last entry is the leaf that actually rendered.
  const leaf = matches?.[matches.length - 1];
  return leaf?.route?.path || UNMATCHED;
}
