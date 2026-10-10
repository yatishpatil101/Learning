/** The caller's own list is a bare array, not a `PageResponse`: it grows with one person's history, and each row
 * carries only the newest message. The desk's queue is paged and thread-less, hence a separate operation. */
import { get, post } from '../../http.js';
import { toMessage, toQueuePage, toSummaryList, toTicketCreate, toViewModel } from './supportMapper.js';

export async function listTickets() {
  return toSummaryList(await get('/support/tickets'));
}

/** Not a role-widened `listTickets`: this is a paged envelope of thread-less summaries.
 * `awaitingReply` is tri-state: omitted means everything, and `false` for "no filter" hides unanswered tickets. */
export async function listSupportQueue({ awaitingReply, page = 0, size = 20, counts = false } = {}) {
  const query = { page, size };
  if (awaitingReply === true || awaitingReply === false) query.awaitingReply = awaitingReply;
  if (counts) query.counts = true;
  return toQueuePage(await get('/admin/support-tickets', query), { page, size });
}

export async function getTicket(id) {
  try {
    return toViewModel(await get(`/support/tickets/${encodeURIComponent(id)}`));
  } catch {
    // Somebody else's ticket is a 404 by design — the id is the only secret. The page renders a
    // missing ticket the same way either way, so there is nothing to distinguish here.
    return null;
  }
}

export async function createTicket(ticket) {
  return toViewModel(await post('/support/tickets', toTicketCreate(ticket)));
}

export async function replyToTicket(id, text) {
  return toMessage(
    await post(`/support/tickets/${encodeURIComponent(id)}/messages`, { body: String(text || '').trim() }),
  );
}

export async function markTicketRead(id) {
  await post(`/support/tickets/${encodeURIComponent(id)}/read`);
}
