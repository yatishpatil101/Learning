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
 * It stores a `priority` and base64 `images` on every message — neither of which exists on the
 * wire. They are emitted here and reported empty/absent by the http provider; the page reads
 * `isHttpDomain('support')` to decide whether to *offer* the controls at all. Emitting them from
 * only one provider is what makes the difference visible in the parity harness instead of in a
 * user's confusion about why their "urgent" ticket was not urgent.
 *
 * ## Identity
 *
 * The mock keys tickets on a typed mobile; the server keys on the session. `createTicket` here still
 * writes the caller's own mobile so the existing store stays queryable, but the *service* signature
 * no longer carries identity — that asymmetry is the point of the seam.
 *
 * ## Which side of the thread the caller is on
 *
 * The same seam now serves the customer's page and the desk's queue (D51), so "who is replying" is
 * a session fact here exactly as it is on the server, not a constant. See `mySide`.
 */
import { readUser } from '../../../lib/auth.js';
import { digits } from '../../../lib/contact.js';
import {
  allTickets as _all,
  ticketsForUser as _forUser,
  getTicket as _get,
  createTicket as _create,
  replyToTicket as _reply,
  markTicketRead as _markRead,
} from '../../../lib/data/support.js';

/** The mobile the mock store keys on — the session's, normalised the way the page normalises it. */
const myMobile = () => digits(readUser()?.mobile || '').replace(/^91/, '');

/**
 * Which side of the two-sided read model the session is on (D50).
 *
 * The server derives this from the principal on every write — a staff reply is a staff message and
 * clears the desk's flag, a customer reply clears theirs — so the mock has to derive it too. It
 * used to be hard-coded to `'customer'`, which was harmless while `Support.jsx` was the only
 * caller and became a real divergence the moment a desk screen replied through the same seam: the
 * mock would have written the operator's answer as if the customer had sent it.
 */
const mySide = () => (['staff', 'admin'].includes(readUser()?.role) ? 'staff' : 'customer');

export async function listTickets() {
  return _forUser(myMobile());
}

/**
 * The platform-wide support queue — the desk's list (D51).
 *
 * The mock store already holds both halves of the two-sided read model (`unreadStaff`,
 * `unreadCustomer`), so `awaitingReply` and `unread` are read off it rather than invented. What the
 * mock does *not* have is a server, so the filter and the window are applied here — over
 * `allTickets()`, which is already sorted newest-activity-first — to produce the same
 * `{ items, total, page, size }` the http provider returns from the envelope.
 *
 * The row deliberately drops `mobile`, `email` and `notes`, all of which the mock store carries and
 * `AdminSupportTicket` does not. Emitting them here would make the demo screen show fields that
 * vanish the day the domain goes live — the failure mode the seam exists to prevent.
 */
export async function listSupportQueue({ awaitingReply, page = 0, size = 20 } = {}) {
  const all = _all().filter((t) => {
    if (awaitingReply === true) return (t.unreadStaff || 0) > 0;
    if (awaitingReply === false) return (t.unreadStaff || 0) === 0;
    return true;
  });
  const from = Math.max(0, page) * size;
  return {
    items: all.slice(from, from + size).map((t) => ({
      id: t.id,
      subject: t.subject || '',
      category: t.category || 'other',
      status: t.status || 'open',
      raiser: t.name || '',
      awaitingReply: (t.unreadStaff || 0) > 0,
      unread: (t.unreadCustomer || 0) > 0,
      createdAt: t.createdAt || 0,
    })),
    total: all.length,
    page,
    size,
  };
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
  const side = mySide();
  const updated = _reply(id, {
    role: side,
    name: u?.name || (side === 'staff' ? 'Support' : 'You'),
    text: text || '',
    images: images || [],
  });
  // The service contract is "resolves to the created message", which is what the server returns.
  // The mock's `replyToTicket` returns the whole ticket, so take the message it just appended.
  return updated ? updated.messages[updated.messages.length - 1] : null;
}

export async function markTicketRead(id) {
  _markRead(id, mySide());
}
