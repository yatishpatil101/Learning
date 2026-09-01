/**
 * HTTP support provider.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `supportService.js` is the
 * only contract between them and `Support.jsx` may not care which one is active. Shape translation
 * lives in `supportMapper.js`.
 *
 * Thin by design: six requests and no client-side state. The caller's own list is a **bare array**,
 * not a `PageResponse` — the contract keeps it unpaged because it grows with one person's own
 * support history, and it carries the full thread inline for the same reason (contrast the
 * conversations inbox, which omits transcripts because a chat can run to hundreds of messages). The
 * desk's queue is the opposite on both counts, and is a separate operation because of it.
 */
import { get, post } from '../../http.js';
import { toMessage, toQueuePage, toTicketCreate, toViewModel, toViewModelList } from './supportMapper.js';

export async function listTickets() {
  return toViewModelList(await get('/support/tickets'));
}

/**
 * The platform-wide support queue — staff/admin (D51).
 *
 * `GET /admin/support-tickets`, a genuinely different operation from `listTickets` rather than a
 * role-widened version of it: a paged envelope of thread-less summaries, where the caller's own
 * list is a bare array carrying every message inline. One operation cannot be both.
 *
 * **Really paged, not "one big page".** The reports queue asks for 100 rows and computes its tabs
 * and counts over what came back, because those numbers would be wrong over a page. Nothing here
 * is computed across rows — the desk reads a window of a server-fixed order, and the filter that
 * matters (`awaitingReply`) is applied server-side against the V53 partial index. So this pages
 * properly and the totals come from the envelope, which is the only way "412 waiting" can be true
 * on page 1 of 21.
 *
 * `awaitingReply` is tri-state and `undefined` is not `false`: omitted means "everything", `false`
 * means the answered complement. Sending `false` for "no filter" would hide exactly the tickets
 * the desk has not answered.
 */
export async function listSupportQueue({ awaitingReply, page = 0, size = 20 } = {}) {
  const query = { page, size };
  if (awaitingReply === true || awaitingReply === false) query.awaitingReply = awaitingReply;
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

/**
 * Reply.
 *
 * `images` is accepted and ignored, matching the mock's signature so the seam holds — there is no
 * upload surface behind it and the contract drops the field rather than storing a client-supplied
 * URL nothing can render. The page does not offer the control in http mode, so this is a
 * belt-and-braces no-op rather than a silent loss.
 */
export async function replyToTicket(id, text) {
  return toMessage(
    await post(`/support/tickets/${encodeURIComponent(id)}/messages`, { body: String(text || '').trim() }),
  );
}

export async function markTicketRead(id) {
  await post(`/support/tickets/${encodeURIComponent(id)}/read`);
}
