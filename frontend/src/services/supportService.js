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
 * | **Status `new`** | the server opens every ticket `open`; `new` does not exist on the wire |
 *
 * All three are surfaced through the provider rather than hidden: the mapper reports what the server
 * actually said, and the page is responsible for not offering a control that cannot work. See
 * `supportMapper.js` for the status vocabulary and `Support.jsx` for how the two are gated.
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
 * Raise a ticket. Resolves to the created ticket, including its server-assigned id.
 *
 * @param {{subject: string, category: string, message: string, priority?: string, images?: string[]}} ticket
 */
export const createTicket = (ticket) => provider().createTicket(ticket);

/** Reply to a ticket. Resolves to the created message. */
export const replyToTicket = (id, text) => provider().replyToTicket(id, text);

/** Clear the "support replied" flag. Idempotent on both providers. */
export const markTicketRead = (id) => provider().markTicketRead(id);
