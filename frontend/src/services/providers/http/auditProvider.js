/**
 * HTTP audit-log provider — the live counterpart to `providers/mock/auditProvider.js`.
 *
 * ## The mock shape and the wire shape overlap in three field names and agree on none of them
 *
 * The browser-local log this replaces stored `{ id, at, who, action, detail }`. The wire row is
 * `{ id, actor, actorRole, action, entity, entityId, checker, at, metadata }`. `id` and `at` carry
 * over. The third shared name is the trap:
 *
 * - **`action`** was a *UI section label* — `'Enquiries'`, `'Site settings'`, `'Maps & Places'` —
 *   composed at the call site from whatever the screen felt like calling itself. On the wire it is
 *   a dotted event name from a fixed vocabulary: `property.status`, `settings.update`,
 *   `city.update`, `locality.archive`, `society.merge`. Same field name, same JSON type, different
 *   universe of values. A repoint that left the column alone would have gone on rendering it, and
 *   the only visible symptom would have been that the words changed.
 * - **`who`** has no counterpart. `actor` is the actor's **UUID**; the column it fed was headed
 *   "User" and held a display name. There is no name on this route by design — that is what
 *   `/admin/staff-activity` is for.
 * - **`detail`** has no counterpart either, and is deliberately not synthesised here. The row
 *   carries `entity` + `entityId` + `metadata`, which is what actually identifies the record and
 *   what changed; a prose sentence assembled in the browser would be a caption written by the
 *   reader, which is exactly what the old log was.
 *
 * `metadata` is already an object by the time it reaches us — `AuditLogController` parses the
 * stored JSON before serialising. It is normalised to `{}` rather than left possibly-null so that
 * callers can enumerate its keys without guarding first.
 */
import { get, unwrapPage } from '../../http.js';

/**
 * Only send parameters that are actually set: an empty string is a filter on the server, so
 * `entity=''` asks for rows whose entity is the empty string rather than for all rows.
 *
 * `action` is **not** in this list and must not be added without a matching `@RequestParam` on
 * `AuditLogController.list`. Spring ignores an unknown query parameter rather than rejecting it, so
 * an `action` sent from here would be dropped in transit and the console would show an unfiltered
 * page while displaying a narrowed filter — a wrong answer with a 200 on it.
 */
const query = ({ actor, entity, entityId, from, to } = {}) => {
  const params = {};
  if (actor) params.actor = actor;
  if (entity) params.entity = entity;
  if (entityId) params.entityId = entityId;
  if (from) params.from = from;
  if (to) params.to = to;
  return params;
};

const toEntry = (r) => ({
  id: r?.id ?? '',
  actor: r?.actor ?? '',
  actorRole: r?.actorRole ?? '',
  action: r?.action ?? '',
  entity: r?.entity ?? '',
  entityId: r?.entityId ?? null,
  checker: r?.checker ?? null,
  at: r?.at ?? null,
  metadata: r?.metadata && typeof r.metadata === 'object' ? r.metadata : {},
});

export async function listAuditLog({ page = 0, size = 50, ...filter } = {}) {
  const res = await get('/admin/audit-log', { ...query(filter), page, size });
  const unwrapped = unwrapPage(res, { page, size });
  return { ...unwrapped, items: (unwrapped.items || []).map(toEntry) };
}
