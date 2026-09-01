/**
 * HTTP ticket provider — the ops work board (`/ops/requests`), live against `GET|POST /tickets`.
 *
 * **There was never a second implementation, and that was the design.** The board's four operations
 * could not be expressed by the mock ticket store without inventing a translation layer: the store
 * knew three statuses where the server knows five, assigned by display name where the server
 * assigns by user id, and returned everything at once where the server pages. D184 already refused
 * exactly that translation for the drafting desk — a second vocabulary that has to be kept in step
 * by hand is a bug with a release date — so `OpsQueue` showed an offline panel rather than a board
 * it could not work. The store and that panel are both gone (P5c).
 *
 * ## Team scoping is the server's, again
 *
 * `TicketService.list` narrows a staff caller to their own desk and **403s** a staffer who names
 * somebody else's, exactly as `ServiceDeskAuthority` does for service requests (D44). The board
 * used to compute `team || (role === 'admin' ? undefined : myTeam)` in the component, which was a
 * client-side restatement of a server rule and therefore a place for the two to disagree. It now
 * sends what the user asked for and lets the server answer.
 *
 * ## What is deliberately absent
 *
 * Free assignment. `TicketUpdate.assigneeId` will accept any ops user, but the board only offers
 * self-claim — the same shape as the drafting desk's *Take*. Handing work to a named stranger
 * needs a staff directory the ops portal does not have, and a rule for what happens when
 * re-teaming a ticket removes it from the assigner's own view (which `TicketService.update`
 * warns it routinely does). Neither was worth inventing to preserve a mock button.
 */
import { get, patch, post } from '../../http.js';
import { toClaim, toCreate, toNote, toViewModel, toViewModelPage, toWireStatus } from './ticketMapper.js';

/**
 * The board — `GET /tickets`, paged.
 *
 * Errors propagate. A queue that renders an unread failure as an empty list is how a desk goes home
 * early, and a 403 here is *information* — it means a staffer asked for a desk that is not theirs,
 * which the caller turns into a sentence rather than a blank table.
 *
 * `team` is sent when given even for a staff caller who can only have one: the server's answer to
 * "show me the legal queue" when you are on valuation is a refusal with a reason, and suppressing
 * the request client-side would replace that reason with silence.
 */
export async function listTicketQueue({ team, status, page = 0, size = 20 } = {}) {
  const query = { page, size };
  if (team) query.team = team;
  const wire = toWireStatus(status);
  if (wire) query.status = wire;
  return toViewModelPage(await get('/tickets', query), { page, size });
}

/**
 * Claim — `PATCH /tickets/{id}` with the caller's own id.
 *
 * Status is not touched. See `toClaim`: claiming and moving are two decisions, and bundling them
 * would advance a ticket the person only meant to put their name against.
 */
export async function claimTicket(id, userId) {
  return toViewModel(await patch(`/tickets/${encodeURIComponent(id)}`, toClaim(userId)));
}

/** Move a ticket — `PATCH /tickets/{id}`. Unknown statuses are the server's 400 to give, not ours. */
export async function setTicketStatus(id, status) {
  return toViewModel(await patch(`/tickets/${encodeURIComponent(id)}`, { status: toWireStatus(status) }));
}

/**
 * Append an internal note — `POST /tickets/{id}/notes`, 201.
 *
 * An append, not a rewrite. The board used to send the whole `notes` array back, which quietly
 * discards anything a colleague added between the read and the write; the endpoint exists so that
 * two people taking notes on one ticket both keep theirs.
 *
 * Returns the new note alone — the server does not re-send the ticket — so the caller pushes it
 * onto the list it already has.
 */
export async function addTicketNote(id, text) {
  return toNote(
    await post(`/tickets/${encodeURIComponent(id)}/notes`, { body: String(text || '').trim() }),
  );
}

/**
 * Raise a ticket — `POST /tickets`, 201.
 *
 * The one route on this controller with no role guard, and the asymmetry is deliberate upstream:
 * "a queue only privileged people can write to collects nothing". The response is the
 * *customer* view (`CustomerTicketDto`), not the staff record — it carries no internal notes — so
 * it is mapped through the same view model but will simply have an empty `notes`.
 */
export async function createTicket(data) {
  return toViewModel(await post('/tickets', toCreate(data)));
}

/**
 * Join a service waitlist — `POST /service-waitlist`, 201, **no body back**.
 *
 * The one route in this file that does not need a signed-in caller, and the only one whose reply is
 * empty. Both follow from what it is for: somebody who has not decided whether this company is worth
 * an account, asking to be told when something launches. An id would be a reference they could never
 * resolve — reading the board is ops-only — and a 409 on a repeat would tell a stranger whether a
 * given number was already on the list, so the server answers 201 either way.
 *
 * **Not routed through `toCreate`.** That mapper is for the ops board's own shape; this endpoint
 * takes three fields and derives everything else — team, subject, priority — server-side, precisely
 * so an anonymous caller cannot put a lead on the legal desk. Passing a ticket-shaped object here
 * would suggest those fields mean something, and they are ignored.
 *
 * Errors propagate, and the caller must wait for this one before telling anybody they are on a list.
 * The failure this replaces was a success message shown for a lead that went nowhere.
 *
 * @param {{service:string, name?:string, mobile:string}} data `service` is a slug the server knows
 *   (`move-in-pack`); an unknown one is a 400. `mobile` is ten digits; malformed is a 422. Too many
 *   from one number in an hour is a 429 with `Retry-After`.
 */
export async function joinServiceWaitlist({ service, name, mobile }) {
  await post('/service-waitlist', { service, name: name || undefined, mobile });
}
