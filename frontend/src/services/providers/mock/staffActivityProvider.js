/**
 * Mock staff-activity provider — the localStorage counterpart to
 * `providers/http/staffActivityProvider.js`.
 *
 * The mock store keeps its own `staffActivity` array, written by `logStaffActivity` from whichever
 * frontend code paths remember to call it. This provider reshapes those entries into the wire shape
 * so the page can be written once, but it cannot make them equivalent, and the difference is worth
 * stating plainly rather than papering over:
 *
 * - The mock log records only what succeeded, only what was done through this browser, and only at
 *   the call sites somebody added. The server's audit log is written inside the transaction that
 *   does the work, so it records every actor, every client and the refusals too.
 * - `category` here is 'listing' | 'service'; on the wire it is the `entity` — the kind of record
 *   acted on. The mock's two values are mapped onto `property` and `ticket` so the page's filters
 *   behave, which is a translation, not a claim that they mean the same thing.
 * - The mock has no notion of a permission, so nothing here refuses a staff caller. On the server
 *   both routes are administrator-only under `audit:read`, which is the actual behaviour under test.
 */
import { listStaffActivity as mockList, getStaffStats } from '../../../lib/mockApi/staff.js';

/** The mock's two-value `category` in the terms the server uses. */
const ENTITY_FOR = { listing: 'property', service: 'ticket' };

const toEntry = (a, i) => ({
  id: a.id || `mock-${i}`,
  actor: a.staffMobile || a.staffName || '',
  actorName: a.staffName || '',
  actorRole: a.staffRole === 'admin' ? 'admin' : 'staff',
  actorTeam: a.staffTeam || null,
  action: a.action || '',
  entity: ENTITY_FOR[a.category] || a.category || '',
  entityId: a.listingId || a.serviceId || null,
  at: a.at,
});

const matches = (entry, { actor, entity, action, from, to, q }) => {
  if (actor && entry.actor !== actor) return false;
  if (entity && entry.entity !== entity) return false;
  if (action && entry.action !== action) return false;
  if (from && new Date(entry.at).getTime() < new Date(from).getTime()) return false;
  if (to && new Date(entry.at).getTime() >= new Date(to).getTime()) return false;
  if (q && q.trim()) {
    const hay = `${entry.actorName} ${entry.action} ${entry.entity} ${entry.entityId || ''}`.toLowerCase();
    if (!hay.includes(q.trim().toLowerCase())) return false;
  }
  return true;
};

async function window_(filter) {
  const raw = await mockList();
  return (Array.isArray(raw) ? raw : []).map(toEntry).filter((e) => matches(e, filter));
}

export async function listStaffActivity({ page = 0, size = 50, ...filter } = {}) {
  const rows = await window_(filter);
  const start = page * size;
  return {
    items: rows.slice(start, start + size),
    page,
    size,
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / size)),
  };
}

export async function getStaffActivitySummary(filter = {}) {
  const rows = await window_(filter);
  const stats = await getStaffStats();

  const counts = new Map();
  for (const row of rows) counts.set(row.entity, (counts.get(row.entity) || 0) + 1);

  return {
    total: rows.length,
    staffCount: new Set(rows.map((r) => r.actor)).size,
    byEntity: [...counts.entries()]
      .map(([entity, count]) => ({ entity, count }))
      .sort((a, b) => b.count - a.count || a.entity.localeCompare(b.entity)),
    actions: [...new Set(rows.map((r) => r.action))].filter(Boolean).sort(),
    leaderboard: (Array.isArray(stats) ? stats : []).map((s) => ({
      actor: s.mobile || s.name,
      name: s.name,
      role: 'staff',
      team: s.team || null,
      total: s.total,
    })),
  };
}
