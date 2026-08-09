/**
 * HTTP deal provider — the live counterpart to `providers/mock/dealProvider.js`.
 *
 * Eighteen endpoints across three controllers, covering one flow: reserve → negotiate → finalize.
 *
 * ```
 *   owner       GET/POST /me/deals[/{propId}][/reserve|close|reopen|parties]   GET /me/offers
 *   buyer       POST /offers · GET /offers/mine · POST /finalization/{propId}/request
 *   either      POST /offers/{id}/respond (counter only, for a buyer)
 *   counterparty GET /me/finalization-requests · POST /finalization/requests/{id}/accept|decline
 * ```
 *
 * ## Every read here is caller-scoped, and that is the whole difference
 *
 * The mock took `ownerMobile` and handed back that owner's bucket, so a buyer could enumerate a
 * stranger's offer book by naming them. Nothing here takes an owner: the token decides. See the
 * note at the top of `dealMapper.js`.
 *
 * ## Two operations the API cannot serve
 *
 * `dealStatusForBuyer` and the buyer's accept-a-counter button. Both are documented at their call
 * sites below rather than smoothed over, because a control that quietly does nothing is worse than
 * one that is absent.
 */
import { del, get, post } from '../../http.js';
import { readAccessToken } from '../../../lib/auth.js';
import {
  mayRespond,
  toDealViewModel,
  toFinalizationViewModel,
  toOfferViewModel,
  toPartyViewModel,
} from './dealMapper.js';

/** Answered locally for a signed-out caller: every route here is caller-scoped, so it can only 401. */
const signedIn = () => !!readAccessToken();

const toList = (rows, fn) => (Array.isArray(rows) ? rows : []).map(fn);

/* ─── Deals (owner-scoped) ──────────────────────────────────────────────────────────────────── */

/** `GET /me/deals` — every deal on the caller's own listings. */
export async function myDeals() {
  if (!signedIn()) return [];
  return toList(await get('/me/deals'), toDealViewModel);
}

/**
 * `GET /me/deals/{propId}` — the deal on one of the caller's listings.
 *
 * **Owner-only.** A property the caller does not own answers 404, deliberately: the server does not
 * confirm the existence of someone else's listing. So this is not the call to make on a public
 * property page — see `dealStatusForBuyer`.
 *
 * A property with no stored deal row is synthesized `active` rather than 404, so a successful
 * response is always a real deal document.
 */
export async function getDeal(propId) {
  if (!signedIn() || !propId) return null;
  return toDealViewModel(await get(`/me/deals/${encodeURIComponent(propId)}`));
}

/**
 * The buyer's view of whether a listing is closed — read from the property itself (D110).
 *
 * The state now rides on the property payload: {@code dealStatus} mirrors the owner-scoped deal
 * (active|reserved|closed), and a closed sale also flips the property's own status to the terminal
 * {@code sold}/{@code rented}. The caller already holds the property view-model from the page load,
 * so this reads its {@code dealStatus} rather than spending a redundant fetch. The server still
 * refuses a stale offer with 409 as the backstop.
 */
export async function dealStatusForBuyer(property) {
  return property?.dealStatus || 'active';
}

/** `POST /me/deals/{propId}/reserve` — mark the listing under offer. 409 on an illegal transition. */
export async function reserveDeal(propId) {
  await post(`/me/deals/${encodeURIComponent(propId)}/reserve`, {});
}

/**
 * `POST /me/deals/{propId}/close` — close the deal.
 *
 * `agreedPrice` and `counterpartyMobile` are **required and validated**: the price must be positive
 * and the mobile must be ten digits. The server rejects a masked number outright rather than
 * storing five plausible digits as somebody's identity.
 *
 * This is why the property page's bare "Finalize deal" button cannot call this directly — it
 * collected neither. The dashboard's finalize modal does collect both, and is the path that works.
 */
export async function closeDeal(propId, { agreedPrice, counterpartyMobile, note } = {}) {
  await post(`/me/deals/${encodeURIComponent(propId)}/close`, {
    agreedPrice: Number(agreedPrice) || 0,
    counterpartyMobile: String(counterpartyMobile || '').replace(/\D/g, ''),
    note: note || undefined,
  });
}

/** `POST /me/deals/{propId}/reopen` — reopen a closed or reserved deal. */
export async function reopenDeal(propId) {
  await post(`/me/deals/${encodeURIComponent(propId)}/reopen`, {});
}

/** `GET /me/deals/{propId}/parties` — off-platform interested parties on a reserved listing. */
export async function listParties(propId) {
  if (!signedIn() || !propId) return [];
  return toList(await get(`/me/deals/${encodeURIComponent(propId)}/parties`), toPartyViewModel);
}

/** `POST /me/deals/{propId}/parties` — record an off-platform interested party. 201. */
export async function addParty(propId, party = {}) {
  return toPartyViewModel(await post(`/me/deals/${encodeURIComponent(propId)}/parties`, {
    name: party.name || 'Interested party',
    mobile: party.mobile ? String(party.mobile).replace(/\D/g, '') : undefined,
    note: party.note || undefined,
  }));
}

/**
 * `DELETE /me/deals/{propId}/parties/{partyId}` — soft-delete a party. 204.
 *
 * Takes the party's **id**. The mock spliced by array index, which is not an identity: a refetch
 * that filters out a soft-deleted row shifts every position after it, and the next remove takes
 * the wrong person.
 */
export async function removeParty(propId, partyId) {
  await del(`/me/deals/${encodeURIComponent(propId)}/parties/${encodeURIComponent(partyId)}`);
}

/* ─── Offers ────────────────────────────────────────────────────────────────────────────────── */

/**
 * `POST /offers` — the buyer opens a negotiation. 201.
 *
 * 409 when a closed deal blocks the listing or the caller already has a live offer on it. That is
 * not smoothed over: the mock raises the same conflict, so a call site cannot be written against
 * the gentler behaviour and break on the day this went live.
 *
 * `moveIn` is a real field now (D112). `OfferCreateRequest` carries it as an optional `date`, so the
 * buyer's preferred possession date travels as its own value — filterable and shown as a field, not
 * buried in `message` prose the way it once was.
 */
export async function submitOffer(req = {}) {
  return toOfferViewModel(await post('/offers', {
    propertyId: req.propId || req.propertyId,
    amount: Number(req.amount) || 0,
    message: req.message || undefined,
    moveIn: req.moveIn || undefined,
  }));
}

/**
 * `POST /offers/{id}/respond` — accept, decline or counter.
 *
 * **Accept and decline are the owner's alone.** A buyer attempting either gets 403, by design: it
 * would let them mark a price as agreed with no owner involvement, and (through the status-driven
 * contact reveal) unmask a mobile the owner never chose to share. Counter is two-sided.
 *
 * The guard is here rather than only at the call site so that every caller inherits it. It throws
 * locally instead of spending a round trip to be told the same thing.
 *
 * Answers 200 with no body, so the caller re-reads rather than being handed a synthesized row.
 */
export async function respondOffer(id, action, counterAmount, opts = {}) {
  if (!mayRespond(action, opts.isOwner)) {
    throw new Error(
      `[deal] Only the listing owner can ${action} an offer. A buyer may only counter.`,
    );
  }
  await post(`/offers/${encodeURIComponent(id)}/respond`, {
    action,
    counterAmount: action === 'counter' ? Number(counterAmount) || 0 : undefined,
    message: opts.message || undefined,
  });
}

/** `GET /offers/mine` — offers the caller **made**, newest first. */
export async function myOffers() {
  if (!signedIn()) return [];
  return toList(await get('/offers/mine'), toOfferViewModel);
}

/** `GET /me/offers` — offers **on** the caller's own listings, newest first. */
export async function offersOnMine() {
  if (!signedIn()) return [];
  return toList(await get('/me/offers'), toOfferViewModel);
}

/* ─── Finalization (maker/checker) ──────────────────────────────────────────────────────────── */

/**
 * `POST /finalization/{propId}/request` — the buyer proposes to close.
 *
 * `counterpartyMobile` and a positive `agreedPrice` are both required. The mock asked for neither,
 * which is why the property page's "Request to finalize" button has to supply them now.
 */
export async function requestFinalization(propId, { counterpartyMobile, agreedPrice } = {}) {
  return toFinalizationViewModel(
    await post(`/finalization/${encodeURIComponent(propId)}/request`, {
      propertyId: propId,
      counterpartyMobile: String(counterpartyMobile || '').replace(/\D/g, ''),
      agreedPrice: Number(agreedPrice) || 0,
    }),
  );
}

/**
 * `GET /finalization/{propId}/status` — the caller's most recent request on this listing.
 *
 * **404 is still a normal answer here.** The endpoint 404s when the caller has never had a request
 * on this property — the ordinary state of every listing nobody has proposed to close — so letting
 * it surface would put a 404 in the console on every property page view. It is caught and mapped to
 * `null`.
 *
 * Terminal rows (declined/cancelled/accepted) are now returned, not pending only (D111): the newest
 * request wins, so a turned-down buyer reads `declined` rather than the same blank state as a buyer
 * who never asked.
 */
export async function finalizationStatus(propId) {
  if (!signedIn() || !propId) return null;
  try {
    return toFinalizationViewModel(await get(`/finalization/${encodeURIComponent(propId)}/status`));
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/** `DELETE /finalization/{propId}/status` — the initiator withdraws their own request. 204. */
export async function cancelFinalization(propId) {
  await del(`/finalization/${encodeURIComponent(propId)}/status`);
}

/**
 * `GET /me/finalization-requests` — requests awaiting the caller's decision.
 *
 * Counterparty-scoped and **not** per-property: the panel filters by `propId` client-side. A
 * per-property variant would be a second endpoint answering a subset of this one.
 */
export async function myFinalizationRequests() {
  if (!signedIn()) return [];
  const rows = await get('/me/finalization-requests');
  return toList(rows, toFinalizationViewModel).filter(Boolean);
}

/**
 * `POST /finalization/requests/{reqId}/accept` — the counterparty agrees.
 *
 * One call does three things server-side: accepts this request, auto-declines every sibling on the
 * same property, and closes the deal. The mock did the same, which is the one place the two already
 * agreed.
 */
export async function acceptFinalization(reqId) {
  await post(`/finalization/requests/${encodeURIComponent(reqId)}/accept`, {});
}

/** `POST /finalization/requests/{reqId}/decline` — the counterparty refuses. */
export async function declineFinalization(reqId) {
  await post(`/finalization/requests/${encodeURIComponent(reqId)}/decline`, {});
}
