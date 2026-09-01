/**
 * Mock audit-log provider — the localStorage counterpart to `providers/http/auditProvider.js`.
 *
 * ## It reads the mock's activity rows, not the mock's old `auditLog` array
 *
 * `puneNestDB.auditLog` still exists in the store and is seeded empty. It was fed by
 * `lib/mockApi/audit.js#logAudit`, which the admin screens no longer call: the server writes its
 * own row inside the transaction that does the work, so a second entry composed in the browser was
 * both duplicate and less trustworthy than the one it duplicated. Reading it here would give the
 * mock console a permanently empty tab and a false idea of the shape.
 *
 * So this reads the same source the mock staff-activity provider reads, and that mirrors the server
 * rather than diverging from it: on the live API `/admin/audit-log` and `/admin/staff-activity` are
 * two questions over one `audit_log` table, and here they are two questions over one mock array.
 *
 * ## What it cannot represent, stated rather than papered over
 *
 * - **No permission model.** On the server this route is administrator-only under `audit:read` and
 *   refuses staff with a 403 — the one behaviour most worth having and the one a mock cannot have.
 *   Nothing here refuses anybody.
 * - **Only successes, only this browser, only where somebody remembered to log.** The server writes
 *   in `REQUIRES_NEW`, so its trail survives a rolled-back transaction and records refusals too.
 * - **`actor` is a mobile number here and a UUID on the wire.** Both are opaque identifiers and
 *   neither is a name, which is the property the console actually depends on; but they are not the
 *   same identifier and a test that pattern-matches one will not match the other.
 * - **`metadata` is empty.** The mock rows carry no structured before/after, so `{}` is returned
 *   rather than a fabricated diff.
 */
import { listStaffActivity as mockList } from '../../../lib/mockApi/staff.js';

/** The mock's two-value `category` in the terms the server uses, as in the staff-activity mock. */
const ENTITY_FOR = { listing: 'property', service: 'ticket' };

const toEntry = (a, i) => ({
  id: a.id || `mock-audit-${i}`,
  actor: a.staffMobile || a.staffName || '',
  actorRole: a.staffRole === 'admin' ? 'admin' : 'staff',
  action: a.action || '',
  entity: ENTITY_FOR[a.category] || a.category || '',
  entityId: a.listingId || a.serviceId || null,
  checker: null,
  at: a.at,
  metadata: {},
});

/** The live filter set exactly — deliberately no `action`, because the server has no such filter. */
const matches = (entry, { actor, entity, entityId, from, to }) => {
  if (actor && entry.actor !== actor) return false;
  if (entity && entry.entity !== entity) return false;
  if (entityId && entry.entityId !== entityId) return false;
  if (from && new Date(entry.at).getTime() < new Date(from).getTime()) return false;
  if (to && new Date(entry.at).getTime() >= new Date(to).getTime()) return false;
  return true;
};

export async function listAuditLog({ page = 0, size = 50, ...filter } = {}) {
  const raw = await mockList();
  const rows = (Array.isArray(raw) ? raw : [])
    .map(toEntry)
    .filter((e) => matches(e, filter))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const start = page * size;
  return {
    items: rows.slice(start, start + size),
    page,
    size,
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / size)),
  };
}
