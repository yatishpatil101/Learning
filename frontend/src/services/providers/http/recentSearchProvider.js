/**
 * Live recent-search provider — the signed-in "resume your search" rail.
 *
 * | Operation | Endpoint                  |
 * | --------- | ------------------------- |
 * | read      | `GET /me/recent-searches` |
 * | record    | `PUT /me/recent-searches` |
 *
 * `PUT` rather than `POST` because recording a search is idempotent on the URL: searching the same
 * thing twice must move one row to the top, not add a second. The server owns the whole rule set —
 * the six-row cap, the dedupe key, the timestamp, and which URLs are even acceptable — and answers
 * both verbs with the caller's complete rail, so the client never models eviction and never has to
 * reconcile two orderings.
 *
 * Nothing identifies the caller in the body or the path. The bearer token does, which is what makes
 * one account's history unreachable from another's.
 */
import { get, put } from '../../http.js';

/* ISO-8601 → epoch ms, matching what the local rail has always stored in `at`.

   `managedMapper.js` carries the same three lines. Deliberately not hoisted: a shared date helper
   would have to be told which of the two null conventions each caller wants, and that argument is
   longer than the function. Guard on NaN rather than falsiness, though — `|| null` would turn a
   legitimate epoch 0 into "no timestamp". */
const toRow = (dto) => ({
  label: dto?.label || '',
  url: dto?.url || '',
  at: dto?.at && !Number.isNaN(Date.parse(dto.at)) ? Date.parse(dto.at) : null,
});

// Both halves are required, not just the url: the server rejects a blank label on write, so a row
// missing one is a row nothing here should have to render. A chip with no words is invisible on
// Home and an empty heading on the Dashboard card.
const toRows = (rows) => (Array.isArray(rows) ? rows.map(toRow).filter((r) => r.url && r.label) : []);

/** The caller's rail, newest first, at most six rows. */
export async function listRecentSearches() {
  return toRows(await get('/me/recent-searches'));
}

/**
 * Record a search and get the resulting rail back.
 *
 * A rejection here is a real failure and is not swallowed: the caller decides whether losing a
 * history row is worth interrupting anything (it is not — see `recentSearchService.js`).
 */
export async function recordRecentSearch({ label, url }) {
  return toRows(await put('/me/recent-searches', { label, url }));
}
