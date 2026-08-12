/**
 * Deal Service — the transaction domain: reserve → negotiate → finalize.
 *
 * Three controllers, eighteen endpoints, one flow:
 *
 *   `/me/deals[/{propId}][/reserve|close|reopen|parties]` · `/offers` · `/offers/mine` ·
 *   `/me/offers` · `/finalization/{propId}/request|status` · `/me/finalization-requests` ·
 *   `/finalization/requests/{id}/accept|decline`
 *
 * ## Why every signature here dropped its first argument
 *
 * The store this replaces took `ownerMobile` everywhere — `isDealClosed(owner, propId)`,
 * `getOffers(owner)`, `acceptFinalize(owner, reqId)`. That parameter is not a detail: it is the
 * caller *naming whose data to read*. localStorage has no identity, so the reader supplies one, and
 * any reader could supply any owner's.
 *
 * The server has no such parameter and no such possibility. `/me/deals` is the caller's listings;
 * `/offers/mine` is the caller's offers. Keeping `ownerMobile` in the seam would preserve a
 * signature that promises something the API will never do, and every call site would have to be
 * rewritten again the day someone noticed. It is gone.
 *
 * ## Two things this domain cannot do, and does not pretend to
 *
 * **A buyer learns a listing's deal state from the listing itself (D110).** {@code dealStatus} is
 * mirrored onto the property payload (active|reserved|closed), and a closed sale flips the
 * property's own status to the terminal {@code sold}/{@code rented} that drops it from search.
 * {@code dealStatusForBuyer(property)} reads that mirror — the wire field in http mode, the client
 * deal store in mock mode — so a buyer on a sold listing sees it is closed rather than a live offer
 * form. The server still refuses a stale offer with 409 as the backstop.
 *
 * **A buyer cannot accept the owner's counter.** Accept and decline are the owner's decision alone
 * (403 otherwise), because otherwise a buyer could mark a price agreed with no owner involvement
 * and unmask a mobile through the status-driven reveal. Counter is the two-sided action; a buyer
 * who wants to agree counters at the owner's number. Both providers enforce this.
 *
 * Both are raised as backend gaps rather than smoothed over.
 */
import { createProvider } from './config.js';

const provider = createProvider('deal');

/* ─── Deals (owner-scoped) ──────────────────────────────────────────────────────────────────── */

/** Every deal on the caller's own listings. Empty for a signed-out caller. */
export const myDeals = async () => (await provider()).myDeals();

/**
 * The deal on one of the caller's own listings — **owner-only**, 404 otherwise.
 * A listing with no deal row resolves to `active` rather than null.
 */
export const getDeal = async (propId) => (await provider()).getDeal(propId);

/**
 * What a non-owner can learn about a listing's deal state, read from the listing itself (D110):
 * {@code active}, {@code reserved} (under offer, still takes offers) or {@code closed}. Takes the
 * property view-model so each provider can resolve it without a second fetch — http off the wire
 * {@code dealStatus}, mock off its client deal store.
 */
export const dealStatusForBuyer = async (property) => (await provider()).dealStatusForBuyer(property);

/** Mark the caller's listing under offer. 409 from a closed deal. */
export const reserveDeal = async (propId) => (await provider()).reserveDeal(propId);

/**
 * Close the deal. **Requires** a positive `agreedPrice` and a real ten-digit `counterpartyMobile`;
 * a masked number is rejected rather than stored as somebody's identity.
 */
export const closeDeal = async (propId, body) => (await provider()).closeDeal(propId, body);

/** Reopen a closed or reserved deal. */
export const reopenDeal = async (propId) => (await provider()).reopenDeal(propId);

/** Off-platform interested parties on a reserved listing. */
export const listParties = async (propId) => (await provider()).listParties(propId);
export const addParty = async (propId, party) => (await provider()).addParty(propId, party);
/** Remove by party **id** — not by array position, which is not an identity. */
export const removeParty = async (propId, partyId) => (await provider()).removeParty(propId, partyId);

/* ─── Offers ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Open a negotiation on a listing. 409 when the caller already has a live offer on it, so the
 * revise path must respond to the existing offer rather than submit a second.
 *
 * `moveIn` has no field on the wire; it is folded into `message` so the owner still reads it.
 */
export const submitOffer = async (req) => (await provider()).submitOffer(req);

/**
 * Accept, decline or counter.
 *
 * @param {string} id
 * @param {'accept'|'decline'|'counter'} action
 * @param {number} [counterAmount] required when countering
 * @param {{isOwner?: boolean, propId?: string, message?: string}} [opts]
 *   `isOwner` gates accept/decline. Both providers throw rather than spend a round trip earning 403.
 */
export const respondOffer = async (id, action, counterAmount, opts) =>
  (await provider()).respondOffer(id, action, counterAmount, opts);

/** Offers the caller made. */
export const myOffers = async () => (await provider()).myOffers();
/** Offers on the caller's own listings. */
export const offersOnMine = async () => (await provider()).offersOnMine();

/* ─── Finalization (maker/checker) ──────────────────────────────────────────────────────────── */

/** Propose to close. Requires the counterparty's mobile and a positive agreed price. */
export const requestFinalization = async (propId, body) => (await provider()).requestFinalization(propId, body);

/**
 * The caller's live request on a listing, or `null`.
 *
 * **Pending only.** A declined request is indistinguishable from never having asked, because the
 * server's query filters on `status = 'pending'`. The panel's "the owner didn't confirm" branch is
 * therefore unreachable in both modes.
 */
export const finalizationStatus = async (propId) => (await provider()).finalizationStatus(propId);

/** Withdraw the caller's own request. */
export const cancelFinalization = async (propId) => (await provider()).cancelFinalization(propId);

/** Requests awaiting the caller's decision, across every property. Filter by `propId` client-side. */
export const myFinalizationRequests = async () => (await provider()).myFinalizationRequests();

/** Accept: closes the deal and auto-declines every sibling on the same property. */
export const acceptFinalization = async (reqId) => (await provider()).acceptFinalization(reqId);
export const declineFinalization = async (reqId) => (await provider()).declineFinalization(reqId);
