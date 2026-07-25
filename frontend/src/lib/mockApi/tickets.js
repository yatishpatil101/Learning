// ---------------- Tickets / service requests ----------------
import { rawLoad, rawSave, delay } from './core.js';

export function listTickets(team) {
  const db = rawLoad();
  const tickets = db.tickets || [];
  return delay(team ? tickets.filter((t) => t.team === team) : tickets);
}

export function updateTicket(id, patch) {
  const db = rawLoad();
  const t = db.tickets.find((x) => x.id === id);
  if (t) {
    Object.assign(t, patch);
    rawSave(db);
  }
  return delay(t);
}

export function createServiceRequest({ team, service, customer, mobile, detail, value = 0, ref = null }) {
  const db = rawLoad();
  const rec = {
    id: 'T' + Date.now(), team, service, customer, mobile, detail,
    status: 'new', priority: 'medium', assignedTo: null, value, ref,
    createdAt: new Date().toISOString().slice(0, 10),
    notes: [{ at: new Date().toISOString().slice(0, 10), by: 'System', text: 'Request received and queued.' }],
  };
  db.tickets.unshift(rec);
  rawSave(db);
  return delay(rec);
}

// Keep the admin service-ticket status truthful by mirroring the real ops workflow
// state (serviceFlow) onto the linked ticket. Matches by the `ref` stamped at creation
// so admin dashboards / AdminServices don't show a request stuck at "new" after it has
// progressed to draft/registration/completed in the ops queue. No-ops for unlinked tickets.
export function syncServiceTicket(ref, status) {
  if (!ref || !status) return;
  const db = rawLoad();
  const t = (db.tickets || []).find((x) => x.ref === ref);
  if (t && t.status !== status) {
    t.status = status;
    if (status === 'in_progress' && !t.assignedTo) { /* leave unassigned; ops owns assignment */ }
    rawSave(db);
  }
}
