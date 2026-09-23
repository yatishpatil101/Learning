/**
 * The audit log — the append-only record of privileged actions.
 *
 *   GET /admin/audit-log   paged, newest first, **administrator only** under `audit:read`
 *
 * There is one read and there will never be a write, an update or a clear. The server has no such
 * route: `AuditService` is the only way a row is created, `AuditLog` marks every column
 * `updatable = false`, and `AuditLogController`'s javadoc says so in as many words — "read-only by
 * construction". A console that offers to edit or empty this is describing a different system.
 *
 * ## Not the same seam as `staffActivityService`
 *
 * Same table, same permission, different question — the distinction is drawn in `Routes.Admin`.
 * `/admin/staff-activity` asks "what has this colleague been doing", is narrowed to back-office
 * actors, and resolves the actor to a person's name because a review needs one. This asks "what
 * happened", over every actor including the system, and does not resolve names.
 *
 * That last point is load-bearing for callers: **`actor` is a UUID, not a name.** Nothing on this
 * route can resolve one. See the row in `tasks/DECISIONS-NEEDED.md` — until it is answered the
 * console shows the role and the id, which are true, rather than a name, which would have to be
 * invented.
 */
import { createProvider } from './config.js';

const provider = createProvider('audit');

/**
 * One page of the trail, newest first.
 *
 * Filters are `actor`, `entity`, `entityId`, `from` and `to` — and that list is exhaustive.
 * There is **no `action` filter and no free-text search**, however much the shape of the other
 * back-office reads suggests there should be. Passing one is not an error: Spring drops an unknown
 * query parameter silently, so `?action=property.status` returns the unfiltered page with a 200 and
 * looks like it worked. Anything not in the list above must be filtered by the caller.
 */
export async function listAuditLog(params) {
  return (await provider()).listAuditLog(params);
}
