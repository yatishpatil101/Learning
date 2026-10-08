/* Published fixtures land on the one shared flatmates board, where card-counting specs (`flatmates/filters`,
   `flatmates/smart-search`) then fail; DELETE is a soft archive, so a 404 here is a success. */
import { API } from './liveAuth.js';

/** Returns the `track(kind, id, token)` function a spec's seed helpers call; afterAll withdraws them. */
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
