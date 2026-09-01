/**
 * HTTP ticket provider — the ops work board (`/ops/requests`), live against `GET|POST /tickets`.
 *
 * **There is no mock counterpart, and that is the design.** The board's four operations cannot be
 * expressed by `lib/mockApi.js`'s ticket store without inventing a translation layer: the store
 * knows three statuses where the server knows five, assigns by display name where the server
 * assigns by user id, and returns everything at once where the server pages. D184 already refused
 * exactly that translation for the drafting desk — a second vocabulary that has to be kept in step
 * by hand is a bug with a release date — so `OpsQueue` gates on `isHttpDomain('ticket')` and shows
 * an offline panel rather than a board it cannot work.
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
