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
 * ## The board is live, and an unreachable server is an error
 *
 * `OpsQueue` renders what the server sends or it fails visibly. It may not answer from a local
 * store: three statuses against the server's five, assignment by display name against assignment
 * by user id, and a whole board against a paged one would need a translation table — a second
 * vocabulary maintained by hand, which drifts. An empty board looks like good news.
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
 * has a reserved word on the server (`"none"`) and no button here.
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
 * Returns the note, not the ticket. A board that sent the whole `notes` array back on every
 * addition would let whichever of two colleagues saved second silently erase the other; the
 * dedicated endpoint exists precisely so that cannot happen.
 *
 * @returns {Promise<{by:string, text:string, at:string|null}>}
 */
export const addTicketNote = async (id, text) => (await provider()).addTicketNote(id, text);

/**
 * Raise a ticket. Any authenticated caller — reading and working the board is ops-only, but
 * writing to it is not, because "a queue only privileged people can write to collects nothing".
 */
export const createTicket = async (data) => (await provider()).createTicket(data);

/**
 * Join the waitlist for a service that has not launched — `POST /service-waitlist`, 201, no body.
 *
 * **The only export here that works without a signed-in caller.** A coming-soon panel that wrote
 * its leads to browser storage and then congratulated the customer would fail invisibly — a person
 * who believed they were on a list nobody had. The lead lands on the same ops board the live Book
 * flow uses, which is where the follow-up call comes from.
 *
 * Resolves to nothing. `await` it before showing a confirmation — that is the whole point.
 *
 * @param {{service:string, name?:string, mobile:string}} data `service` is a server-known slug
 *   (`move-in-pack`). Team, subject and priority are **not** parameters: they are derived from the
 *   slug server-side so an anonymous caller cannot choose which desk it pages.
 */
export const joinServiceWaitlist = async (data) => (await provider()).joinServiceWaitlist(data);
