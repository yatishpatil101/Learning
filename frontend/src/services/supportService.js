/**
 * Support Service — the customer's own support tickets.
 *
 * `GET|POST /support/tickets`, `GET /support/tickets/{id}`,
 * `POST /support/tickets/{id}/messages`, `POST /support/tickets/{id}/read`.
 *
 * Five operations, one page (`pages/consumer/Support.jsx`), and a near-perfect one-to-one mapping
 * onto the mock's five functions. The wiring is routine. What is not routine is that **three
 * controls on that page have no server behind them**, and this module is where that is written down
 * rather than discovered.
 *
 * ## Identity is the session, not the form
 *
 * The form collects `name` and `mobile` and validates the mobile with `/^[6-9]\d{9}$/`. The mock
 * keyed tickets on that typed mobile; the server takes the raiser from the authenticated caller and
 * `SupportTicketCreate` has no identity field at all — deliberately, since a body field would let
 * anyone file a ticket in someone else's name and then read the reply from their own list.
 *
 * `/support` is a `ProtectedRoute`, so there is always a session. The fields therefore stay as
 * prefilled contact details the *human* reads, and stop being the key anything is stored under.
 *
 * ## What the page offers that the API does not
 *
 * | Control | Live behaviour |
 * |---|---|
 * | **Priority** (low/normal/high/urgent) | not on `SupportTicket` *or* `SupportTicketCreate` — the picker sets a value nothing transmits |
 * | **Image attachments** (up to 4, base64) | `MessageCreate` is `{ body }` only; the contract notes attachments are "accepted and dropped rather than stored as a client-supplied URL nothing can render" |
 *
 * Both are surfaced through the provider rather than hidden: the mapper reports what the server
 * actually said, and the page is responsible for not offering a control that cannot work. The status
 * vocabulary is now shared — the mock opens tickets `open` and moves them to `in-progress`, matching
 * the server — so there is no longer a mock-only `new` to reconcile. See `supportMapper.js` for the
 * status pass-through and `Support.jsx` for how the offered controls are gated.
 *
 * ## Shape
 *
 * `listTickets` returns view models in the page's existing vocabulary, so `TicketList`,
 * `TicketThreadModal` and `TicketForm` did not have to be rewritten around wire names:
 *
 *   { id, subject, category, status, priority, unread, updatedAt, createdAt,
 *     messages: [{ id, by, name, text, images, at }] }
 *
 * `priority` and `images` are present-but-empty against the API rather than absent, because every
 * consumer reads them unguarded and a missing key renders as `undefined` in a chip.
 */
import { createProvider } from './config.js';

const provider = createProvider('support');

/**
 * The caller's own tickets, newest first.
 *
 * Bare list, not paged: it grows with one person's own support history, which is the api-standards
 * §5.1 test for when a list may stay unpaged.
 *
 * @returns {Promise<object[]>}
 */
export const listTickets = () => provider().listTickets();

/** One ticket with its full thread, or null if it is not the caller's. */
export const getTicket = (id) => provider().getTicket(id);

/**
 * The platform-wide support queue, paged — **staff and admin only** (D51).
 *
 * `GET /admin/support-tickets`. The second operation in this domain with a different audience from
 * the rest, following the reports queue: a consumer session gets a 403, which is the endpoint
 * working rather than an error to handle, so this is never called from a consumer surface.
 *
 * Deliberately *not* `listTickets` with a wider scope. The two answers have different shapes for
 * good reasons — the caller's own list is an unpaged bare array carrying every message inline, and
 * "every support conversation on the platform" in that shape is a PII export by another name — so
 * the contract made them different operations and so does the seam.
 *
 * Rows carry no thread, no mobile and no internal notes; `raiser` is a display name and may be
 * blank. Paged for real: `total` is the whole queue, not the rows in hand.
 *
 * @param {{awaitingReply?: boolean, page?: number, size?: number}} [opts]
 *   `awaitingReply` omitted means everything; `true` narrows to tickets whose newest message is
 *   from the customer and nobody on the desk has read; `false` is the complement.
 * @returns {Promise<{items: object[], total: number, page: number, size: number}>}
 */
export const listSupportQueue = (opts) => provider().listSupportQueue(opts);

/**
 * Raise a ticket. Resolves to the created ticket, including its server-assigned id.
 *
 * @param {{subject: string, category: string, message: string, priority?: string, images?: string[]}} ticket
 */
export const createTicket = (ticket) => provider().createTicket(ticket);

/** Reply to a ticket. Resolves to the created message. */
export const replyToTicket = (id, text) => provider().replyToTicket(id, text);

/**
 * Clear the "unread" flag on the caller's own side of the thread. Idempotent on both providers.
 *
 * Two-sided (D50): the raiser's call clears "support replied", a staff call clears the desk's own
 * signal, and neither touches the other. Which side the caller is on is derived from the session,
 * never passed in — a parameter here would let one side clear the other's flag.
 */
export const markTicketRead = (id) => provider().markTicketRead(id);
