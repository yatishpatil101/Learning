/**
 * Mock page view provider — the offline counterpart to `providers/http/pageViewProvider.js`.
 *
 * ## Why this discards the batch
 *
 * The other mock providers keep their writes in `localStorage` so the demo can read them back. This
 * one has nothing to read them back *for*. Page views exist to be aggregated across everybody into
 * the admin traffic charts, and those charts read the server's daily rollup — so a mock store would
 * be written by one browser, read by nobody, and grow for the length of the session.
 *
 * Storing them anyway would be worse than useless. A per-session log of every page one person
 * visited is the most identifying artefact this feature produces, and mock mode is the mode that
 * runs on demo laptops and in the e2e suite, where nobody is watching what accumulates in a browser
 * profile. There is no report that wants it and a clear reason not to have it.
 *
 * So the seam is honoured — mock mode never calls the API, and the beacon runs identically in both
 * modes, which is what keeps the collection path exercised rather than dead in every environment
 * that is not production.
 */

/**
 * Accept the flush and drop it.
 *
 * Resolves rather than rejects, and returns `true` for the same reason the live provider does: the
 * caller has no recovery to offer and no branch to take. See `pageViewService.recordPageViews`.
 */
export async function recordPageViews() {
  return true;
}
