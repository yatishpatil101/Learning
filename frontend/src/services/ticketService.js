/**
 * Ticket Service — the ops work board.
 *
 * `GET|POST /tickets`, `PATCH /tickets/{id}`, `POST /tickets/{id}/notes`.
 *
 * Not to be confused with `supportService.js`, which also has a `listTickets`. The two are
 * different entities that unfortunately share a noun: **support** tickets are a customer's own
 * conversation with the company (`/support`, `support_tickets`), while these are the **ops work
 * board** — a row per piece of work a desk owes somebody (`tickets`, `/ops/requests`), with a
 * team, a priority, an assignee and internal notes the customer never sees. The exports here are
 * named `…TicketQueue` / `…TicketNote` so that an import list makes it obvious which one is in
 * play.
 *
 * ## Live-only, and why
 *
 * There is no mock provider. `lib/mockApi.js`'s ticket store speaks three statuses to the server's
 * five, assigns by display name where the server assigns by user id, and returns the whole board
 * where the server pages. Reconciling that needs a translation table, which D184 refused for the
 * drafting desk on the grounds that a second vocabulary maintained by hand drifts. `OpsQueue`
 * therefore gates on `isHttpDomain('ticket')` and says so when it cannot see, rather than
 * rendering an empty board that looks like good news.
 *
 * ## The rules that are no longer this layer's business
 *
 * - **Team scoping.** A staff caller sees their own desk and is refused another by name; an admin
 *   sees everything. `TicketService.list` decides, the component does not narrow.
 * - **Which statuses exist.** `TicketStatuses` — `open`, `in-progress`, `waiting`, `resolved`,
 *   `closed`. An unknown one is a 400 rather than a row that renders as a blank chip.
 * - **Whether an assignee is real.** An id that does not resolve to an ops user is a 404.
 */
import { createProvider } from './config.js';

const provider = createProvider('ticket');

/**
 * A page of the board, newest first.
 *
 * Genuinely paged: `total` is the envelope's `totalElements`, so the counts above the table stay
 * true past page 1. Sort is fixed server-side and index-backed (V21) — sending `?sort=` is an
 * unmapped-property 500, so this never offers one.
 *
 * @param {{team?:string, status?:string, page?:number, size?:number}} [opts]
 * @returns {Promise<{items:object[], total:number, page:number, size:number}>}
 */
export const listTicketQueue = async (opts) => (await provider()).listTicketQueue(opts);

/**
 * Put your own name against a ticket.
 *
 * **Self-claim only.** The endpoint would accept any ops user id, but the board does not offer the
 * choice: assigning to somebody else needs a staff directory the ops portal has never had, and
 * `TicketService.update` warns that re-teaming a ticket routinely removes it from the assigner's
 * own view — a footgun worth a deliberate decision rather than a dropdown. Unassigning likewise
 * has a reserved word on the server (`"none"`, debt D46) and no button here.
 *
 * Does not change the status. Claiming is putting your name on something; deciding it is in
 * progress is a separate act.
 */
export const claimTicket = async (id, userId) => (await provider()).claimTicket(id, userId);

/** Move a ticket to one of the server's five statuses. */
export const setTicketStatus = async (id, status) => (await provider()).setTicketStatus(id, status);

/**
 * Append an internal note — an append, never a rewrite.
 *
 * Returns the note, not the ticket. The old board sent the whole `notes` array back on every
 * addition, so whichever of two colleagues saved second silently erased the other; there is a
 * dedicated endpoint precisely so that cannot happen.
 *
 * @returns {Promise<{by:string, text:string, at:string|null}>}
 */
export const addTicketNote = async (id, text) => (await provider()).addTicketNote(id, text);

/**
 * Raise a ticket. Any authenticated caller — reading and working the board is ops-only, but
 * writing to it is not, because "a queue only privileged people can write to collects nothing".
 */
export const createTicket = async (data) => (await provider()).createTicket(data);
