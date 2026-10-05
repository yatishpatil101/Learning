
/** `/me/finalization-requests` is what awaits the caller's decision. The token decides; there is nothing to pass. */
/** Offer statuses the server will accept a transition *out of*. Everything else is terminal. */
const LIVE_OFFER_STATUSES = ['pending', 'countered'];

/** An offer with no history at all has only ever been submitted, which is the buyer — the same answer, derived rather
 * than assumed. */
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
    /* Buyer verification is server-stated because `buyerMobile` is contact-gated. */
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

/** Counter is the one two-sided action; that is what makes this a negotiation rather than a form submission. */
export const mayRespond = (action, isOwner) => action === 'counter' || !!isOwner;

/** True when the offer is still in a state the server will transition. */
export const isOfferLive = (status) => LIVE_OFFER_STATUSES.includes(status);

/* No stored deal means `active`, not null, matching `getDeal`'s synthesized document. */
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

export function toPartyViewModel(row) {
  return {
    id: row?.id || '',
    name: row?.name || 'Interested party',
    mobile: row?.mobile || '',
    note: row?.note || '',
    at: row?.at ? Date.parse(row.at) : Date.now(),
  };
}

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
