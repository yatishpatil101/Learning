/* Service-requests (tickets) helpers for the Admin › Service Requests page.
   New module (never edit mockApi.js). Ports AdminData.TEAMS/TEAM_LABEL,
   AdminData.addTicketNote, and AdminUI.statusLabel from the HTML app so the
   React page reaches exact parity. */
import { mutateDb } from '../mockApi.js';

export const TEAMS = ['rental', 'legal', 'loans', 'interior', 'packers', 'valuation'];

export const TEAM_LABEL = {
  rental: 'Rent Agreement',
  legal: 'Property & Legal',
  loans: 'Home Loans',
  interior: 'Interior & Renovation',
  packers: 'Packers & Movers',
  valuation: 'Property Valuation',
};

const STATUS_LABEL = {
  new: 'New',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function statusLabel(status) {
  return STATUS_LABEL[status] || status || '';
}

/* Append an internal note to a ticket (port of AdminData.addTicketNote). */
export function addTicketNote(id, text, by = 'Staff') {
  return mutateDb((db) => {
    const t = (db.tickets || []).find((x) => x.id === id);
    if (t) {
      t.notes = t.notes || [];
      t.notes.push({ at: new Date().toISOString().slice(0, 10), by, text });
    }
    return t;
  });
}
