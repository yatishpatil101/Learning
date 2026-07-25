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

// ---------------- Admin KPIs (derived) ----------------
export function getAdminKpis() {
  const db = rawLoad();
  let activeCount = 0, approved = 0, pending = 0, archived = 0;
  for (const l of db.listings) {
    if (l.archived) { archived++; continue; }
    activeCount++;
    if (l.status === 'approved') approved++;
    else if (l.status === 'pending') pending++;
  }
  const openTickets = db.tickets.filter((t) => t.status === 'new' || t.status === 'in_progress').length;
  const revenue = db.analytics.revenue.reduce((a, m) => a + m.subscriptions + m.services + m.featured, 0);
  return delay({
    users: db.users.filter((u) => (u.role === 'buyer' || u.role === 'owner') && !u.archived).length,
    listings: activeCount, approved, pending, archived,
    openTickets, deals: db.deals.length, enquiries: db.enquiries.length, revenue,
  });
}
