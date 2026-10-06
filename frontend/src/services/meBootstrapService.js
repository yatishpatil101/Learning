import { get, prime } from './http.js';

// Each entry must be the exact read its context makes (path and query), or the seed goes unused.
// The 500s match SavedContext's PAGE_SIZE and societyProvider's FOLLOW_PAGE_SIZE.
const SECTIONS = [
  ['me', '/auth/me'],
  ['subscription', '/me/subscription'],
  ['identity', '/me/verification/identity'],
  ['saved', '/me/saved', { page: 0, size: 500 }],
  ['savedSearches', '/me/saved-searches'],
  ['following', '/me/societies/following', { page: 0, size: 500 }],
  ['notificationsUnread', '/notifications/unread-count'],
  ['messagesUnread', '/messages/unread-count'],
];

// One `GET /me/bootstrap` instead of the signed-in shell's eight reads. Call it before the contexts
// that make those reads mount or re-run; a missing section falls back to its own request.
export function primeMeBootstrap() {
  const doc = get('/me/bootstrap');
  for (const [name, path, query] of SECTIONS) prime(path, query, doc.then((d) => d?.[name]));
}
