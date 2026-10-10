/** Only self-claim is offered, not free assignment: naming another user needs a staff directory the ops portal
 * lacks, and re-teaming a ticket can remove it from the assigner's own view. */
import { get, patch, post } from '../../http.js';
import { toClaim, toCreate, toNote, toViewModel, toViewModelPage, toWireStatus } from './ticketMapper.js';

/** Errors propagate: a queue that renders an unread failure as an empty list sends a desk home early,
 * and a 403 is information the caller turns into a sentence rather than a blank table. */
export async function listTicketQueue({ status, team, priority, q, page = 0, size = 20 } = {}) {
  const query = { page, size };
  const wire = toWireStatus(status);
  if (wire) query.status = wire;
  if (team) query.team = team;
  if (priority) query.priority = priority;
  if (q) query.q = q;
  return toViewModelPage(await get('/tickets', query), { page, size });
}

/** Per-status counts for the caller's scope — GET /tickets/summary, so tab pills never depend on a page of rows. */
export async function getTicketSummary(team) {
  return get('/tickets/summary', team ? { team } : {});
}

/** One ticket with its notes and values — the list rows carry neither. */
export async function getTicket(id) {
  return toViewModel(await get(`/tickets/${encodeURIComponent(id)}`));
}

/** Status is untouched (see `toClaim`): claiming and moving are two decisions,
 * and bundling them would advance a ticket the person only meant to claim. */
export async function claimTicket(id, userId) {
  return toViewModel(await patch(`/tickets/${encodeURIComponent(id)}`, toClaim(userId)));
}

/** Move a ticket — `PATCH /tickets/{id}`. Unknown statuses are the server's 400 to give, not ours. */
export async function setTicketStatus(id, status) {
  return toViewModel(await patch(`/tickets/${encodeURIComponent(id)}`, { status: toWireStatus(status) }));
}

/** An append, not a rewrite: sending the whole `notes` array back would discard a colleague's concurrent note.
 * Returns the new note alone, so the caller pushes it onto the list it already holds. */
export async function addTicketNote(id, text) {
  return toNote(
    await post(`/tickets/${encodeURIComponent(id)}/notes`, { body: String(text || '').trim() }),
  );
}

/** The one route on this controller with no role guard: "a queue only privileged people can write to collects
 * nothing". The response is the customer view (`CustomerTicketDto`), so `notes` is always empty. */
export async function createTicket(data) {
  return toViewModel(await post('/tickets', toCreate(data)));
}

/** Unauthenticated and bodyless: a 409 on a repeat would reveal whether a number is listed, so it answers 201.
 * Not routed through `toCreate`: desk and priority are server-derived, so no anonymous caller picks the desk. */
export async function joinServiceWaitlist({ service, name, mobile }) {
  await post('/service-waitlist', { service, name: name || undefined, mobile });
}
