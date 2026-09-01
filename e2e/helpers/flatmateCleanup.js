/**
 * Take back what a flatmate spec put on the public board.
 *
 * A group or room only reaches the seeker-facing feed once a moderator lets it out, so any spec
 * that exercises the seeker side has to publish its fixtures. That publication is global: the
 * flatmates board is one shared list, and the UI specs that count cards on it (`live-filters`,
 * `live-smart-search`) then see a board with a dozen strangers' groups on it and fail on numbers
 * that were correct when they were written. Each spec passed alone and the wave failed together,
 * which is the least useful failure mode a suite has.
 *
 * The database is reset once per run, not once per file, so "it is only test data" is not a
 * defence — within a run the pollution is real and it is ordered by filename. A spec that
 * publishes therefore withdraws, and `archive` is exactly the verb for it: `DELETE` on either
 * resource is a soft archive by the host, the same call the host's own "remove this post" button
 * makes. Nothing is truly destroyed and nothing is asserted about the result, because by the time
 * teardown runs a test may well have deleted its own fixture already — a 404 here is a success.
 */
import { API } from './liveAuth.js';

/**
 * Wire a spec file's teardown. Returns the `track` function its seed helpers should call.
 *
 * @param {import('@playwright/test').TestType} test the spec's `test` object
 * @returns {(kind: 'groups'|'rooms'|'posts', id: string, token: string) => void}
 */
export function flatmateCleanup(test) {
  const posted = [];

  test.afterAll(async () => {
    // Newest first: a group whose seats a later test filled is likelier to be the one another
    // spec is about to trip over, and this way one failure does not strand the rest.
    for (const { kind, id, token } of posted.reverse()) {
      await fetch(`${API}/flatmates/${kind}/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  });

  return (kind, id, token) => posted.push({ kind, id, token });
}
