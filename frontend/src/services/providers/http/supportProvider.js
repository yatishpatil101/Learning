/**
 * HTTP support provider — the live counterpart to `providers/mock/supportProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `supportService.js` is the
 * only contract between them and `Support.jsx` may not care which one is active. Shape translation
 * lives in `supportMapper.js`.
 *
 * Thin by design: five requests and no client-side state. The list is a **bare array**, not a
 * `PageResponse` — the contract keeps it unpaged because it grows with one person's own support
 * history, and it carries the full thread inline for the same reason (contrast the conversations
 * inbox, which omits transcripts because a chat can run to hundreds of messages).
 */
import { get, post } from '../../http.js';
import { toMessage, toTicketCreate, toViewModel, toViewModelList } from './supportMapper.js';

export async function listTickets() {
  return toViewModelList(await get('/support/tickets'));
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
