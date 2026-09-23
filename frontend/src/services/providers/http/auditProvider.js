// `action` is a dotted event name from a fixed vocabulary (`property.status`, `city.update`), not a
// UI label; `actor` is a UUID, not a display name — names are `/admin/staff-activity`.

// There is no prose `detail` and one is not synthesised here. `metadata` arrives already parsed and
// is normalised to `{}` so callers can enumerate its keys without guarding.
import { get, unwrapPage } from '../../http.js';

// Only send parameters that are actually set: an empty string is a filter on the server, so
// `entity=''` asks for rows whose entity is the empty string.

// `action` is **not** here and must not be added without a matching `@RequestParam` — Spring drops
// an unknown parameter, so the console would show an unfiltered page under a narrowed filter.
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
