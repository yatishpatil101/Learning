/**
 * Mock support provider — the localStorage counterpart to `providers/http/supportProvider.js`.
 *
 * Storage stays exactly where it was (`puneNestSupport` via `lib/data/support.js`), so the ops-side
 * ticket views and the demo history keep working unchanged. What this adds is the provider *shape*:
 * the same five operations the http provider exposes, in the same argument order, returning the same
 * view models.
 *
 * ## The mock is the richer one, and that is the slice
 *
 * It stores a `priority`, base64 `images` on every message, and a `new` status — none of which exist
 * on the wire. They are emitted here and reported empty/absent by the http provider; the page reads
 * `isHttpDomain('support')` to decide whether to *offer* the controls at all. Emitting them from
 * only one provider is what makes the difference visible in the parity harness instead of in a
 * user's confusion about why their "urgent" ticket was not urgent.
 *
 * ## Identity
 *
 * The mock keys tickets on a typed mobile; the server keys on the session. `createTicket` here still
 * writes the caller's own mobile so the existing store stays queryable, but the *service* signature
 * no longer carries identity — that asymmetry is the point of the seam.
 */
import { readUser } from '../../../lib/auth.js';
import { digits } from '../../../lib/contact.js';
import {
  ticketsForUser as _forUser,
  getTicket as _get,
  createTicket as _create,
  replyToTicket as _reply,
  markTicketRead as _markRead,
} from '../../../lib/data/support.js';

/** The mobile the mock store keys on — the session's, normalised the way the page normalises it. */
const myMobile = () => digits(readUser()?.mobile || '').replace(/^91/, '');

export async function listTickets() {
  return _forUser(myMobile());
}

export async function getTicket(id) {
  return _get(id) ?? null;
}

export async function createTicket(ticket) {
  const u = readUser();
  return _create({
    mobile: myMobile(),
    name: u?.name || 'Customer',
    email: u?.email || '',
    category: ticket?.category || 'other',
    // Mock-only, and deliberately still stored: the demo's ops queue sorts on it. The http provider
    // reports '' for the same field, which is what the parity harness pins.
    priority: ticket?.priority || 'normal',
    subject: ticket?.subject || '',
    message: ticket?.message || '',
    images: ticket?.images || [],
  });
}

export async function replyToTicket(id, text, images) {
  const u = readUser();
  const updated = _reply(id, {
    role: 'customer',
    name: u?.name || 'You',
    text: text || '',
    images: images || [],
  });
  // The service contract is "resolves to the created message", which is what the server returns.
  // The mock's `replyToTicket` returns the whole ticket, so take the message it just appended.
  return updated ? updated.messages[updated.messages.length - 1] : null;
}

export async function markTicketRead(id) {
  _markRead(id, 'customer');
}
