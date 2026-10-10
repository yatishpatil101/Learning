import { get, prime } from './http.js';

// Each entry must be the exact read its context makes (path and query), or the seed goes unused.
const SECTIONS = [
  ['me', '/auth/me'],
  ['subscription', '/me/subscription'],
  ['saved', '/me/saved/keys'],
  ['notificationsUnread', '/notifications/unread-count'],
  ['messagesUnread', '/messages/unread-count'],
];

// One `GET /me/bootstrap` instead of the signed-in shell's five reads. Call it before the contexts
// that make those reads mount or re-run; a missing section falls back to its own request.
export function primeMeBootstrap() {
  const doc = get('/me/bootstrap');
  for (const [name, path, query] of SECTIONS) prime(path, query, doc.then((d) => d?.[name]));
}
