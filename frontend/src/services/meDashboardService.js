import { get, prime, PAGE_LOAD_TTL } from './http.js';
import { MAX_PAGE_SIZE } from './apiLimits.js';
import { readAccessToken } from '../lib/auth.js';

const PAGE = { page: 0, size: MAX_PAGE_SIZE };
const SIZE = { size: MAX_PAGE_SIZE };

// Each entry must be the exact read its provider makes (path and query, in that key order), or the
// seed goes unused.
const SECTIONS = [
  ['listings', '/me/listings', SIZE],
  ['flatmatePosts', '/me/flatmate-posts', PAGE],
  ['flatmateRooms', '/me/flatmate-rooms', PAGE],
  ['flatmateGroups', '/me/flatmate-groups', PAGE],
  ['contactRequests', '/me/contact-requests', PAGE],
  ['photoRequests', '/me/photo-requests', PAGE],
  ['documentRequests', '/me/documents/requests', SIZE],
  ['flatmateRequests', '/me/flatmate-requests', SIZE],
  ['groupApplications', '/me/group-applications', PAGE],
  ['visits', '/visits', SIZE],
  ['visitRequests', '/me/visit-requests', SIZE],
  ['tenancies', '/me/tenancies'],
  ['propertyReviews', '/me/property-reviews', PAGE],
  ['recentSearches', '/me/recent-searches'],
  ['serviceRequestInvites', '/me/service-request-invites'],
  ['managedProperties', '/me/managed-properties'],
  ['entitlements', '/me/entitlements'],
  ['deals', '/me/deals', SIZE],
];

// One `GET /me/dashboard` replaces the dashboard's and owner hub's inbox reads; seeds outlive their first reader because panels re-read while mounting.
export function primeMeDashboard() {
  if (!readAccessToken()) return;
  const doc = get('/me/dashboard');
  for (const [name, path, query] of SECTIONS) {
    prime(path, query, doc.then((d) => d?.[name]), { ttl: PAGE_LOAD_TTL });
  }
}
