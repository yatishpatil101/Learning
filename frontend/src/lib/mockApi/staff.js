// ---------------- Staff activity tracking ----------------
/* Tracks which staff member performed which action — used for performance reviews,
   leaderboard, and internal accountability. Separate from audit log (which is admin-only). */
import { rawLoad, rawSave, delay, currentStaffInfo } from './core.js';

export function logStaffActivity({ action, category, detail, meta = {} }) {
  const db = rawLoad();
  if (!Array.isArray(db.staffActivity)) db.staffActivity = [];
  const staff = currentStaffInfo();
  const entry = {
    ...meta,
    id: 'SA' + Date.now() + Math.floor(Math.random() * 1000),
    at: new Date().toISOString(),
    staffName: staff.name,
    staffMobile: staff.mobile,
    staffRole: staff.role,
    staffTeam: staff.team,
    action: String(action || ''),
    category: String(category || ''),
    detail: String(detail || ''),
  };
  db.staffActivity.unshift(entry);
  if (db.staffActivity.length > 500) db.staffActivity = db.staffActivity.slice(0, 500);
  rawSave(db);
}

export function listStaffActivity(filters = {}) {
  const db = rawLoad();
  let list = Array.isArray(db.staffActivity) ? db.staffActivity : [];
  if (filters.staffName) list = list.filter((a) => a.staffName === filters.staffName);
  if (filters.category) list = list.filter((a) => a.category === filters.category);
  if (filters.action) list = list.filter((a) => a.action === filters.action);
  return delay(list);
}

export function getStaffStats() {
  const db = rawLoad();
  const list = Array.isArray(db.staffActivity) ? db.staffActivity : [];
  const byStaff = {};
  for (const a of list) {
    if (!byStaff[a.staffName]) byStaff[a.staffName] = { name: a.staffName, mobile: a.staffMobile, team: a.staffTeam, total: 0, listings: 0, services: 0 };
    byStaff[a.staffName].total++;
    if (a.category === 'listing') byStaff[a.staffName].listings++;
    if (a.category === 'service') byStaff[a.staffName].services++;
  }
  const stats = Object.values(byStaff).sort((a, b) => b.total - a.total);
  return delay(stats);
}

export function scheduleVisit({ listingId, listing, customer, mobile, when, note = '' }) {
  const db = rawLoad();
  const rec = { id: 'V' + Date.now(), listingId, listing, customer, mobile, when, note, status: 'scheduled' };
  db.visits.unshift(rec);
  rawSave(db);
  return delay(rec);
}

// Update a visit in place (status change, reschedule). Persists so owner actions
// on the dashboard survive reloads and stay in sync across every visit view.
export function updateVisit(id, patch = {}) {
  const db = rawLoad();
  const list = db.visits || [];
  const i = list.findIndex((v) => v.id === id);
  if (i === -1) return delay(null);
  list[i] = { ...list[i], ...patch };
  rawSave(db);
  return delay(list[i]);
}

/* ---------------- Admin KPIs (derived) — deleted ----------------
 *
 * `getAdminKpis()` lived here and computed nine counters from the browser database. Its only
 * caller was `AdminDashboard.jsx`, which fetched it in a `Promise.all`, destructured the result,
 * stored it on state, and then never read it — every tile on that screen is re-derived from the
 * raw collections in the same render. The call is gone (see the comment at AdminDashboard.jsx:83
 * for why it was deleted rather than pointed at `GET /admin/dashboard`), which left this function
 * with no caller at all, so it goes too rather than sitting here looking load-bearing.
 *
 * Note for anyone porting the dashboard later: this shape and the server's are not the same
 * object. This returned `{ users, listings, approved, pending, archived, openTickets, deals,
 * enquiries, revenue }`; `AdminKpis` returns `{ totalListings, activeListings, pendingModeration,
 * openReports, totalUsers, newUsers7d, dealsClosed30d, revenue30d }`. Four of the nine have no
 * counterpart and three of the eight have no origin here. That mismatch is the reason the port is
 * a decision, not a swap.
 */
