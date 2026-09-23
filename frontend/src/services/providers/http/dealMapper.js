/**
 * Wire ↔ seam translation for the transaction domain: deals, offers and finalization.
 *
 * ## 1. Every read is keyed on the caller
 *
 * `/me/deals` is the caller's own listings, `/offers/mine` is the offers the caller made,
 * `/me/finalization-requests` is what awaits the caller's decision. The token decides; there is
 * nothing to pass.
 *
 * So the seam takes no `ownerMobile`. That is not a simplification — it is the security property,
 * and the seam must not offer a signature implying a caller may name an owner and read the offers
 * made to them.
 *
 * ## 2. `from` never moves on the wire
 *
 * `OfferDto.from` is the **buyer who opened the negotiation** and never changes; who moved last is
 * the final `history[].by`.
 *
 * Reading `from` as "who moved last" would invert the UI's read of every countered offer —
 * "you countered" and "buyer countered" would swap. `lastActorOf` is the real equivalent.
 */

/** Offer statuses the server will accept a transition *out of*. Everything else is terminal. */
const LIVE_OFFER_STATUSES = ['pending', 'countered'];

/**
 * Who moved last on an offer.
 *
 * The submit event is recorded `by: 'buyer'` and each counter appends the side that countered, so
 * the last entry is the current mover. An offer with no history at all has only ever been
 * submitted, which is the buyer — the same answer, derived rather than assumed.
 */
export function lastActorOf(history) {
  const entries = Array.isArray(history) ? history : [];
  return entries.length ? entries[entries.length - 1].by || 'buyer' : 'buyer';
}

/** Wire `OfferDto` → the seam's offer shape. */
export function toOfferViewModel(row) {
  const history = Array.isArray(row?.history) ? row.history : [];
  return {
    id: row?.id || '',
    propId: row?.propertyId || '',
    propertyId: row?.propertyId || '',
    amount: Number(row?.amount) || 0,
    status: row?.status || 'pending',
    message: row?.message || '',
    // `from` keeps the vocabulary the panel already reads ("did I move last, or they?"), but it is
    // derived from history rather than taken from the wire's `from`, which means something else.
    from: lastActorOf(history),
    // The offer's author, which is what the wire's `from` actually is — not the field named `from`
    // above, which answers "who moved last".
    buyerId: row?.from?.id || '',
    buyerName: row?.from?.name || 'Buyer',
    // Contact-gated server-side: arrives masked until the owner approves. Passed through as-is —
    // masking is the server's decision, and a client that "helpfully" unmasked would defeat it.
    buyerMobile: row?.from?.mobile || '',
    // The Verified Tenant badge, stated by the server. It has to be, because the only other
    // thing the panel could key it on is `buyerMobile` above — which is masked for every viewer but
    // the buyer themselves, and `98XXXXX210` matches no real number, so the badge would be
    // permanently absent. Read the flag; never re-derive it from the digits the mask destroyed.
    buyerVerified: row?.from?.verified === true,
    history: history.map((h) => ({
      amount: Number(h?.amount) || 0,
      by: h?.by || 'buyer',
      at: h?.at ? Date.parse(h.at) : null,
    })),
    createdAt: row?.createdAt ? Date.parse(row.createdAt) : Date.now(),
    // The buyer's preferred possession date. `OfferDto` carries it as an ISO `date`
    // string; passed through as-is (empty when the buyer named none).
    moveIn: row?.moveIn || '',
  };
}

/**
 * ## 3. Only the owner may accept or decline
 *
 * `OfferService.respond` is explicit: accept and decline are the owner's decision alone, and a
 * non-owner attempting either gets **403** (not 404 — the buyer is a legitimate participant who may
 * read the offer, they just may not decide it). Counter is the one two-sided action; that is what
 * makes this a negotiation rather than a form submission.
 *
 * So the property page's "Accept ₹X" button cannot be offered to the *buyer* when the *owner* has
 * countered. Without this predicate it fails as an unexplained 403 after the toast has already said
 * the deal was agreed.
 *
 * @param {string} action `accept` | `decline` | `counter`
 * @param {boolean} isOwner whether the caller owns the listing
 */
export const mayRespond = (action, isOwner) => action === 'counter' || !!isOwner;

/** True when the offer is still in a state the server will transition. */
export const isOfferLive = (status) => LIVE_OFFER_STATUSES.includes(status);

/**
 * Wire `DealDto` → the seam's deal shape.
 *
 * `getDeal` synthesizes an `active` deal when no row exists rather than 404ing, so an untouched
 * property answers with a real document. The seam mirrors that: no deal is `active`, never null,
 * because "this listing has never been reserved" and "this listing is open" are the same state.
 */
export function toDealViewModel(row) {
  const status = row?.status || 'active';
  return {
    id: row?.id || '',
    propId: row?.propertyId || '',
    propertyId: row?.propertyId || '',
    // `deal` is the intent (buy/rent), carried from the property. Distinct from `status`, which is
    // the lifecycle.
    deal: row?.deal || 'buy',
    status,
    agreedPrice: row?.agreedPrice == null ? null : Number(row.agreedPrice),
    closedAt: row?.closedAt ? Date.parse(row.closedAt) : null,
    counterpartyName: row?.counterparty?.name || '',
    counterpartyMobile: row?.counterparty?.mobile || '',
    counterpartyId: row?.counterparty?.id || '',
  };
}

export const isClosed = (status) => status === 'closed';
export const isReserved = (status) => status === 'reserved';

/**
 * ## 4. Parties are identified by id, not by array index
 *
 * `DELETE .../parties/{partyId}` takes a server id. Position is not a stable identity — two owners
 * removing concurrently, or a soft-deleted row filtered out of a refetch, and an index removes the
 * wrong person. The seam carries `id` and the call sites pass it.
 */
export function toPartyViewModel(row) {
  return {
    id: row?.id || '',
    name: row?.name || 'Interested party',
    mobile: row?.mobile || '',
    note: row?.note || '',
    at: row?.at ? Date.parse(row.at) : Date.now(),
  };
}

/**
 * Wire `FinalizationRequestDto` → the seam's shape.
 *
 * ## 5. Terminal requests are readable, so `declined` is a status the buyer can observe
 *
 * `GET /finalization/{propId}/status` returns the caller's <em>most recent</em> request on the
 * property, whatever its status — not pending only. So a declined or cancelled request is returned
 * and is distinguishable from never having asked (which still answers 404 → `null`).
 *
 * The property page has a third branch on exactly that distinction: a buyer whose request was
 * turned down sees "the owner didn't confirm — you can ask again". `finalizeStatusOf` returns the
 * row's real status (`declined`), which is what makes that branch reachable.
 */
export function toFinalizationViewModel(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    propId: row.propertyId || '',
    propertyId: row.propertyId || '',
    status: row.status || 'pending',
    agreedPrice: Number(row.agreedPrice) || 0,
    initiatorId: row.initiator?.id || '',
    // The panel labels each pending row with who is asking, which for the owner's inbox is the
    // buyer. `buyerName` keeps the name the existing markup reads.
    buyerName: row.initiator?.name || 'Buyer',
    buyerMobile: row.initiator?.mobile || '',
    // As on an offer: the initiator's number is masked at every finalization status, so the
    // badge can only come from the server's own flag.
    buyerVerified: row.initiator?.verified === true,
    counterpartyId: row.counterparty?.id || '',
    counterpartyName: row.counterparty?.name || '',
    createdAt: row.createdAt ? Date.parse(row.createdAt) : Date.now(),
  };
}

/** `none` when there is no request at all; otherwise the row's real status (incl. `declined`). */
export const finalizeStatusOf = (row) => (row && row.id ? row.status || 'pending' : 'none');
