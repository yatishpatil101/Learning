/**
 * Mock deal provider — the localStorage counterpart to `providers/http/dealProvider.js`.
 *
 * ## What this tightens, and why it has to
 *
 * The mock store this wraps is keyed by **owner mobile** and enforces almost nothing. The server is
 * keyed by the caller and enforces a great deal. Every difference below is the mock being made
 * *stricter* to match, never the reverse — a mock more permissive than the server passes tests the
 * real thing would fail, which is how a slice ships green and breaks on switch-on.
 *
 * | Rule | Mock before | Here (and on the server) |
 * |---|---|---|
 * | Who can read an owner's deals/offers | anyone naming the owner | the owner only |
 * | Who can accept or decline an offer | anyone | the listing owner only (403) |
 * | Second live offer on one listing | allowed, stacked | 409 |
 * | Party removal | by array index | by id |
 * | Closing a deal | no price, no counterparty | both required and validated |
 *
 * The owner-scoped reads resolve the owner from the **signed-in user** rather than a parameter,
 * which is exactly what the token does server-side.
 */
import { ApiError } from '../../http.js';
import { readUser } from '../../../lib/auth.js';
import { digits, myMobile } from '../../../lib/contact.js';
import { rawDb } from '../../../lib/mockApi.js';
import { getListings } from '../../../lib/store.js';
import {
  getDeals,
  getDeal as _storeGetDeal,
  closeDeal as _storeClose,
  reopenDeal as _storeReopen,
  markUnderOffer as _storeReserve,
  getUnderOfferParties,
  addUnderOfferParty,
  removeUnderOfferParty,
  getDealReqs,
  saveDealReqs,
  getOffers,
  addOffer as _storeAddOffer,
  respondOffer as _storeRespond,
} from '../../../lib/store/deals.js';

/** The signed-in caller's mobile — the mock's stand-in for the bearer token's subject. */
const me = () => digits(myMobile() || '');

/* `ApiError` takes an options **object** (`{ code, message, status, ... }`), not positional
   arguments. Constructing it positionally leaves `status` undefined, so every `err.status === 403`
   branch at a call site silently falls through to the generic path. */
const conflict = (message) => new ApiError({ code: 'conflict', status: 409, message });
const forbidden = (message) => new ApiError({ code: 'forbidden', status: 403, message });
const notFound = (what) => new ApiError({ code: 'not_found', status: 404, message: `${what} not found` });
const badRequest = (message) => new ApiError({ code: 'bad_request', status: 400, message });
const unauthorized = () => new ApiError({ code: 'unauthorized', status: 401, message: 'Sign in to continue' });

/**
 * The owner mobile recorded against a listing.
 *
 * Resolved from the **catalogue**, not from `getListings()`. That store holds only the listings the
 * signed-in user created in this browser; a seeded property has no row in it, so an ownership test
 * built on it alone answers "not yours" for every listing the demo data ships — which silently
 * empties the owner's offer book. This is the mock's equivalent of `properties.owner_id`.
 *
 * `rawDb()` rather than `getProperty()`: the latter is async (it models network delay), and every
 * ownership check here is on a synchronous path.
 */
function ownerOf(propId) {
  const local = getListings().find((x) => String(x.id) === String(propId));
  if (local) return digits(local.ownerMobile || local.owner?.mobile || me());
  try {
    const row = (rawDb()?.listings || []).find((p) => String(p.id) === String(propId));
    return digits(row?.ownerMobile || row?.owner?.mobile || '');
  } catch {
    return '';
  }
}

/** True when the caller owns this listing. The mock's equivalent of `findByIdAndOwner_Id`. */
function ownsListing(propId) {
  const mine = me();
  if (!mine) return false;
  if (getListings().some((l) => String(l.id) === String(propId))) return true;
  return ownerOf(propId) === mine;
}

/**
 * 404 rather than 403 for a property the caller does not own — matching `DealService.ownedProperty`,
 * which deliberately does not confirm the existence of someone else's listing.
 */
function ownedOrThrow(propId) {
  if (!ownsListing(propId)) throw notFound('Property');
  return String(propId);
}

const dealVm = (propId, row) => ({
  id: row?.id || `d-${propId}`,
  propId: String(propId),
  propertyId: String(propId),
  deal: (typeof row?.deal === 'string' && row.deal) || 'buy',
  status: row?.status || 'active',
  agreedPrice: row?.closedWith?.finalPrice ?? row?.closedWith?.rent ?? null,
  closedAt: row?.status === 'closed' ? row?.at || null : null,
  counterpartyName: row?.closedWith?.name || row?.closedWith?.buyerName || '',
  counterpartyMobile: digits(row?.closedWith?.mobile || row?.closedWith?.buyerMobile || ''),
  counterpartyId: '',
});

/* ─── Deals (owner-scoped) ──────────────────────────────────────────────────────────────────── */

/** Every deal on the caller's own listings. Scoped to owned ids, as `/me/deals` is. */
export async function myDeals() {
  const mine = me();
  if (!mine) return [];
  const all = getDeals(mine) || {};
  return Object.keys(all)
    .filter((propId) => ownsListing(propId))
    .map((propId) => dealVm(propId, all[propId]));
}

/** The deal on one of the caller's listings. Synthesizes `active` when untouched, never 404s for it. */
export async function getDeal(propId) {
  const mine = me();
  if (!mine || !propId) return null;
  ownedOrThrow(propId);
  return dealVm(propId, _storeGetDeal(mine, String(propId)));
}

/**
 * The buyer's view of a listing's deal state (D110), read from the property's owner-keyed deal in
 * the client store — the mock stand-in for the wire's mirrored {@code dealStatus} field. A listing
 * with no stored deal resolves to {@code active}. Owner-keyed rather than caller-keyed because this
 * is public information about the listing, not the caller's own bucket.
 */
export async function dealStatusForBuyer(property) {
  if (!property) return 'active';
  const owner = digits(property.ownerMobile || '');
  const propId = String(property.uuid || property.id || '');
  if (!owner || !propId) return 'active';
  return _storeGetDeal(owner, propId)?.status || 'active';
}

export async function reserveDeal(propId) {
  const mine = me();
  ownedOrThrow(propId);
  const current = _storeGetDeal(mine, String(propId));
  // `DealStatuses.canTransition` refuses reserve from closed. Mirrored so the 409 is not a surprise.
  if (current?.status === 'closed') throw conflict('Cannot reserve a deal in status closed');
  _storeReserve(mine, String(propId), current?.deal || 'buy', []);
}

/**
 * Close the deal. `agreedPrice` and a ten-digit `counterpartyMobile` are both required.
 *
 * The mobile is validated rather than stored as given: a masked number (`98XXXXX210`) strips to
 * five digits, and a lenient normaliser would happily persist a mask as somebody's identity — the
 * exact defect the server guards against, so the mock guards against it too.
 */
export async function closeDeal(propId, { agreedPrice, counterpartyMobile, note } = {}) {
  const mine = me();
  ownedOrThrow(propId);
  const price = Number(agreedPrice) || 0;
  if (price <= 0) throw badRequest('agreedPrice must be positive');
  const mobile = digits(counterpartyMobile || '');
  if (mobile.length !== 10) {
    throw badRequest('counterpartyMobile must be a 10-digit mobile number');
  }
  const current = _storeGetDeal(mine, String(propId));
  if (current?.status === 'closed') throw conflict('Cannot close a deal in status closed');
  _storeClose(mine, String(propId), current?.deal || 'buy', {
    name: '', mobile, finalPrice: price, note: note || '',
  });
}

export async function reopenDeal(propId) {
  const mine = me();
  ownedOrThrow(propId);
  _storeReopen(mine, String(propId));
}

export async function listParties(propId) {
  const mine = me();
  if (!mine || !propId) return [];
  ownedOrThrow(propId);
  // The store holds parties positionally with no id. One is synthesized from the index so the
  // seam's id-based contract holds on both sides; it is stable for as long as the array is.
  return (getUnderOfferParties(mine, String(propId)) || []).map((p, i) => ({
    id: p.id || `p${i}`,
    name: p.name || 'Interested party',
    mobile: digits(p.mobile || ''),
    note: p.note || '',
    at: p.at || Date.now(),
  }));
}

export async function addParty(propId, party = {}) {
  const mine = me();
  ownedOrThrow(propId);
  const list = addUnderOfferParty(mine, String(propId), party) || [];
  const i = list.length - 1;
  const added = list[i] || {};
  return {
    id: added.id || `p${i}`,
    name: added.name || 'Interested party',
    mobile: digits(added.mobile || ''),
    note: added.note || '',
    at: added.at || Date.now(),
  };
}

/** Remove by **id**, resolving it back to a position — the store is still positional underneath. */
export async function removeParty(propId, partyId) {
  const mine = me();
  ownedOrThrow(propId);
  const list = await listParties(propId);
  const idx = list.findIndex((p) => String(p.id) === String(partyId));
  if (idx < 0) throw notFound('Party');
  removeUnderOfferParty(mine, String(propId), idx);
}

/* ─── Offers ────────────────────────────────────────────────────────────────────────────────── */

/**
 * The listing's owner mobile, which is the bucket key every offer read/write needs.
 *
 * Falls back to the caller only when the catalogue has no answer — a locally-created listing with
 * no recorded owner is the caller's own by construction.
 */
const ownerMobileFor = (propId) => ownerOf(propId) || me();

const offerVm = (o) => ({
  id: o.id,
  propId: String(o.propId || ''),
  propertyId: String(o.propId || ''),
  amount: Number(o.amount) || 0,
  status: o.status || 'pending',
  message: o.message || '',
  // The store's `from` already means "who moved last", which is what the seam carries. The http
  // provider has to derive the same thing from history, because the wire's `from` is the author.
  from: o.from || 'buyer',
  buyerId: '',
  buyerName: o.buyerName || 'Buyer',
  buyerMobile: digits(o.buyerMobile || ''),
  history: (o.history || []).map((h) => ({ amount: Number(h.amount) || 0, by: h.by || 'buyer', at: h.at || null })),
  createdAt: o.at || Date.now(),
  moveIn: o.moveIn || '',
});

/**
 * Open a negotiation. 409 when the caller already has a live offer on this listing — the server
 * refuses the duplicate, so the mock must too or the revise-offer path is written against a
 * behaviour that does not exist.
 */
export async function submitOffer(req = {}) {
  const u = readUser();
  if (!u) throw unauthorized();
  const propId = String(req.propId || req.propertyId || '');
  const owner = ownerMobileFor(propId);
  const mine = me();
  const live = getOffers(owner).find(
    (o) => String(o.propId) === propId && digits(o.buyerMobile) === mine
      && (o.status === 'pending' || o.status === 'countered'),
  );
  if (live) throw conflict('A live offer already exists on this listing');
  const rec = _storeAddOffer(owner, {
    propId,
    amount: Number(req.amount) || 0,
    moveIn: req.moveIn || '',
    message: req.message || '',
    deal: req.deal || 'buy',
  });
  return offerVm(rec);
}

/**
 * Respond to an offer.
 *
 * Accept and decline are the owner's alone — a buyer attempting either gets 403, exactly as
 * `OfferService.respond` does. This is the single most important thing this provider tightens: the
 * property page had an "Accept ₹X" button on the *buyer's* side, and against the mock it worked.
 */
export async function respondOffer(id, action, counterAmount, opts = {}) {
  const owner = opts.propId ? ownerMobileFor(opts.propId) : me();
  const target = getOffers(owner).find((o) => o.id === id);
  if (!target) throw notFound('Offer');
  const isOwner = opts.isOwner != null ? !!opts.isOwner : digits(owner) === me();
  if (!isOwner && action !== 'counter') {
    throw forbidden(`Only the listing owner can ${action} an offer`);
  }
  if (action === 'counter' && !(Number(counterAmount) > 0)) {
    throw badRequest("counterAmount is required when action is 'counter'");
  }
  if (target.status !== 'pending' && target.status !== 'countered') {
    throw conflict(`Cannot ${action} an offer in status ${target.status}`);
  }
  // The store distinguishes an owner counter from a buyer counter by action name; the server
  // infers the side from the caller. Same outcome, resolved here so the seam has one verb.
  const storeAction = action === 'counter' && !isOwner ? 'buyer_counter' : action;
  _storeRespond(owner, id, storeAction, Number(counterAmount) || 0);
}

/**
 * Offers the caller **made**, across every listing.
 *
 * Offers live in owner-keyed buckets, so finding the caller's own means sweeping the buckets of
 * every owner they could have transacted with: the catalogue's owners plus their own.
 */
export async function myOffers() {
  const mine = me();
  if (!mine) return [];
  const owners = new Set([mine]);
  try {
    (rawDb()?.listings || []).forEach((l) => {
      const o = digits(l.ownerMobile || l.owner?.mobile || '');
      if (o) owners.add(o);
    });
  } catch { /* an unreadable mock db just means fewer buckets to sweep */ }
  getListings().forEach((l) => {
    const o = digits(l.ownerMobile || l.owner?.mobile || '');
    if (o) owners.add(o);
  });
  const out = [];
  owners.forEach((owner) => {
    getOffers(owner).forEach((o) => { if (digits(o.buyerMobile) === mine) out.push(offerVm(o)); });
  });
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Offers **on** the caller's own listings. Scoped to owned ids, as `/me/offers` is. */
export async function offersOnMine() {
  const mine = me();
  if (!mine) return [];
  return getOffers(mine)
    .filter((o) => ownsListing(o.propId))
    .map(offerVm)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/* ─── Finalization ──────────────────────────────────────────────────────────────────────────── */

const finVm = (r, propId) => ({
  id: r.id,
  propId: String(r.propId || propId || ''),
  propertyId: String(r.propId || propId || ''),
  status: r.status || 'pending',
  agreedPrice: Number(r.agreedPrice) || 0,
  initiatorId: '',
  buyerName: r.buyerName || 'Buyer',
  buyerMobile: digits(r.buyerMobile || ''),
  counterpartyId: '',
  counterpartyName: '',
  createdAt: r.at || Date.now(),
});

export async function requestFinalization(propId, { counterpartyMobile, agreedPrice } = {}) {
  const u = readUser();
  if (!u) throw unauthorized();
  if (!(Number(agreedPrice) > 0)) {
    throw badRequest('agreedPrice must be positive');
  }
  const owner = digits(counterpartyMobile || ownerMobileFor(propId));
  if (owner.length !== 10) {
    throw badRequest('counterpartyMobile must be a 10-digit mobile number');
  }
  const reqs = getDealReqs(owner);
  const mine = me();
  const live = reqs.find((r) => String(r.propId) === String(propId) && digits(r.buyerMobile) === mine && r.status === 'pending');
  if (live) return finVm(live, propId);
  const rec = {
    id: `f${Date.now()}`,
    propId: String(propId),
    deal: 'buy',
    buyerName: u.name || 'Buyer',
    buyerMobile: mine,
    agreedPrice: Number(agreedPrice) || 0,
    status: 'pending',
    at: Date.now(),
  };
  reqs.unshift(rec);
  saveDealReqs(owner, reqs);
  return finVm(rec, propId);
}

/**
 * The caller's most recent request on this listing, whatever its status.
 *
 * Returns terminal rows (declined/cancelled/accepted), not pending only, matching the server's
 * `findRecentByPropertyAndParticipant` (D111): a declined request must be distinguishable from
 * never having asked so the property page's "the owner didn't confirm" branch is reachable.
 */
export async function finalizationStatus(propId) {
  const mine = me();
  if (!mine || !propId) return null;
  const owner = ownerMobileFor(propId);
  const row = getDealReqs(owner)
    .filter(
      (r) => String(r.propId) === String(propId)
        && (digits(r.buyerMobile) === mine || digits(owner) === mine),
    )
    .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))[0];
  return row ? finVm(row, propId) : null;
}

export async function cancelFinalization(propId) {
  const mine = me();
  const owner = ownerMobileFor(propId);
  const kept = getDealReqs(owner).filter(
    (r) => !(String(r.propId) === String(propId) && digits(r.buyerMobile) === mine && r.status === 'pending'),
  );
  saveDealReqs(owner, kept);
}

/** Requests awaiting the caller's decision — counterparty-scoped, all properties. */
export async function myFinalizationRequests() {
  const mine = me();
  if (!mine) return [];
  return getDealReqs(mine).filter((r) => r.status === 'pending').map((r) => finVm(r));
}

/** Accept: closes the deal and auto-declines every sibling on the same property. */
export async function acceptFinalization(reqId) {
  const mine = me();
  const reqs = getDealReqs(mine);
  const target = reqs.find((r) => r.id === reqId);
  if (!target) throw notFound('Finalization request');
  target.status = 'accepted';
  reqs.forEach((r) => {
    if (r.id !== reqId && String(r.propId) === String(target.propId) && r.status === 'pending') r.status = 'declined';
  });
  saveDealReqs(mine, reqs);
  _storeClose(mine, String(target.propId), target.deal || 'buy', {
    name: target.buyerName,
    mobile: digits(target.buyerMobile),
    finalPrice: Number(target.agreedPrice) || 0,
  });
}

export async function declineFinalization(reqId) {
  const mine = me();
  const reqs = getDealReqs(mine);
  const target = reqs.find((r) => r.id === reqId);
  if (!target) throw notFound('Finalization request');
  target.status = 'declined';
  saveDealReqs(mine, reqs);
}
