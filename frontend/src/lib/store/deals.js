import { readUser } from '../auth.js';
import { digits, myMobile } from '../contact.js';
import { get, parseAmount, set } from './internals.js';
import { addTenancy } from './rent.js';

/* =========================================================================
   Deals: a closed property is no longer active for other users.
   Lifecycle: 'active' (no entry) -> 'reserved' (Under Offer) -> 'closed'.
   ========================================================================= */

/* Every bucket below is named by the owner's **account id**, never by their mobile number.
   Three properties of a mobile make it unfit to name a bucket, and the server has none of them:
   it is mutable (change your number and your deals are filed under a name nothing looks up any
   more), it is maskable (a third party holds `98XXXXX210`, which strips to `98210` — so owners
   sharing a first-two/last-three pattern land in one bucket and read each other's deals), and it
   is not guaranteed unique (a shared or re-issued number is two accounts). `owner_id` is none of
   those, which is exactly why the server chose it.

   The divergence was the real cost: a mock that files rows differently from its server passes
   tests the server would fail, and the difference only surfaces after switch-on.

   `null` — an owner whose identity cannot be established, e.g. because only a masked number is in
   hand — is not a bucket. It reads empty and swallows writes, rather than falling back to a shared
   `'anon'` bucket, which *was* the collision. Ids are resolved by `lib/data/ownerIdentity.js`. */
const dealKey = (ownerId) => (ownerId ? 'puneNestDeals:' + ownerId : null);
const readBucket = (key, empty) => (key ? get(key, empty) : empty);
const writeBucket = (key, value) => (key ? set(key, value) : value);

export const getDeals = (ownerId) => readBucket(dealKey(ownerId), {});
export const getDeal = (ownerId, propId) => getDeals(ownerId)[propId || ''] || null;
export const isDealClosed = (ownerId, propId) => {
  const d = getDeal(ownerId, propId);
  return !!(d && d.status === 'closed');
};
export const dealStatus = (ownerId, propId) => {
  const d = getDeal(ownerId, propId);
  return d && (d.status === 'closed' || d.status === 'reserved') ? d.status : 'active';
};
export const isDealReserved = (ownerId, propId) => dealStatus(ownerId, propId) === 'reserved';
export const closeDeal = (ownerId, propId, deal, closedWith) => {
  if (!propId) return;
  const all = getDeals(ownerId);
  const prev = all[propId] || {};
  all[propId] = { status: 'closed', deal: deal || prev.deal || 'buy', at: Date.now(), closedWith: closedWith || null };
  writeBucket(dealKey(ownerId), all);
};
export const reopenDeal = (ownerId, propId) => {
  const all = getDeals(ownerId);
  delete all[propId || ''];
  writeBucket(dealKey(ownerId), all);
};
export const markUnderOffer = (ownerId, propId, deal, parties) => {
  if (!propId) return;
  const all = getDeals(ownerId);
  const prev = all[propId] || {};
  all[propId] = {
    status: 'reserved',
    deal: deal || prev.deal || 'buy',
    at: prev.status === 'reserved' && prev.at ? prev.at : Date.now(),
    parties: parties != null ? parties : prev.parties || [],
  };
  writeBucket(dealKey(ownerId), all);
  return all[propId];
};
export const getUnderOfferParties = (ownerId, propId) => {
  const d = getDeal(ownerId, propId);
  return (d && d.parties) || [];
};
export const addUnderOfferParty = (ownerId, propId, party) => {
  if (!propId || !party) return;
  let all = getDeals(ownerId);
  let d = all[propId];
  if (!d || d.status !== 'reserved') {
    markUnderOffer(ownerId, propId);
    all = getDeals(ownerId);
  }
  all[propId].parties = all[propId].parties || [];
  all[propId].parties.push({ name: party.name || 'Interested party', note: party.note || '', mobile: digits(party.mobile || ''), at: Date.now() });
  writeBucket(dealKey(ownerId), all);
  return all[propId].parties;
};
export const removeUnderOfferParty = (ownerId, propId, idx) => {
  const all = getDeals(ownerId);
  const d = all[propId];
  if (!d || !d.parties) return;
  d.parties.splice(idx, 1);
  writeBucket(dealKey(ownerId), all);
  return d.parties;
};

/* =========================================================================
   Maker-checker finalization: buyer requests, owner confirms/declines.
   ========================================================================= */
const dealReqKey = (ownerId) => (ownerId ? 'puneNestDealReq:' + ownerId : null);
export const getDealReqs = (ownerId) => readBucket(dealReqKey(ownerId), []);
export const saveDealReqs = (ownerId, arr) => writeBucket(dealReqKey(ownerId), arr);
export const requestFinalize = (ownerId, propId, deal) => {
  const u = readUser();
  if (!u) return 'login';
  const mine = digits(u.mobile);
  const reqs = getDealReqs(ownerId);
  if (reqs.filter((r) => r.propId === (propId || '') && r.buyerMobile === mine && r.status === 'pending')[0]) return 'pending';
  reqs.unshift({ id: 'f' + Date.now(), propId: propId || '', deal: deal || 'buy', buyerName: u.name || 'Buyer', buyerMobile: mine, status: 'pending', at: Date.now() });
  saveDealReqs(ownerId, reqs);
  return 'pending';
};
export const myFinalizeStatus = (ownerId, propId) => {
  const mine = myMobile();
  if (!mine) return 'none';
  const reqs = getDealReqs(ownerId).filter((r) => r.propId === (propId || '') && r.buyerMobile === mine);
  return reqs.length ? reqs[0].status : 'none';
};
export const cancelFinalize = (ownerId, propId) => {
  const mine = myMobile();
  const reqs = getDealReqs(ownerId).filter((r) => !(r.propId === (propId || '') && r.buyerMobile === mine && r.status === 'pending'));
  saveDealReqs(ownerId, reqs);
};
export const pendingFinalizeFor = (ownerId, propId) =>
  getDealReqs(ownerId).filter((r) => r.propId === (propId || '') && r.status === 'pending');
export const pendingFinalizeCount = (ownerId) =>
  getDealReqs(ownerId).filter((r) => r.status === 'pending').length;
export const acceptFinalize = (ownerId, reqId, meta) => {
  const reqs = getDealReqs(ownerId);
  let target = null;
  reqs.forEach((r) => {
    if (r.id === reqId) {
      r.status = 'accepted';
      target = r;
    }
  });
  if (target) reqs.forEach((r) => { if (r.propId === target.propId && r.status === 'pending') r.status = 'declined'; });
  saveDealReqs(ownerId, reqs);
  if (target) {
    meta = meta || {};
    const dealKind = meta.deal || target.deal || 'buy';
    const rent = meta.rent != null ? parseAmount(meta.rent) : 0;
    closeDeal(ownerId, target.propId, dealKind, {
      name: target.buyerName,
      mobile: digits(target.buyerMobile),
      rent,
      title: meta.title || '',
      address: meta.address || '',
    });
    if (dealKind === 'rent') {
      addTenancy(target.buyerMobile, {
        // The tenancy's owner mobile is a number the tenant will dial, so it comes from the
        // caller's metadata. It used to be read off the bucket key, which only worked while the
        // key happened to be a phone number.
        ownerMobile: digits(meta.ownerMobile || ''),
        ownerName: meta.ownerName || '',
        propId: target.propId,
        title: meta.title || '',
        address: meta.address || '',
        rent,
        deal: 'rent',
      });
    }
  }
  return target;
};
export const declineFinalize = (ownerId, reqId) => {
  const reqs = getDealReqs(ownerId);
  reqs.forEach((r) => { if (r.id === reqId) r.status = 'declined'; });
  saveDealReqs(ownerId, reqs);
};

/* =========================================================================
   In-app offers / negotiation (per owner)
   ========================================================================= */
const offerKey = (ownerId) => (ownerId ? 'pnOffers:' + ownerId : null);
export const getOffers = (ownerId) => readBucket(offerKey(ownerId), []);
export const saveOffers = (ownerId, arr) => writeBucket(offerKey(ownerId), arr);
export const addOffer = (ownerId, o) => {
  const u = readUser();
  if (!u) return 'login';
  const arr = getOffers(ownerId);
  const rec = Object.assign({ id: 'of' + Date.now(), buyerName: u.name || 'Buyer', buyerMobile: digits(u.mobile), status: 'pending', from: 'buyer', at: Date.now(), history: [] }, o || {});
  arr.unshift(rec);
  saveOffers(ownerId, arr);
  return rec;
};
export const myOffer = (ownerId, propId) => {
  const mine = myMobile();
  return getOffers(ownerId).filter((r) => r.propId === (propId || '') && r.buyerMobile === mine)[0] || null;
};
export const offersFor = (ownerId, propId) =>
  getOffers(ownerId).filter((r) => propId == null || r.propId === propId);
export const pendingOfferCount = (ownerId) =>
  getOffers(ownerId).filter((r) => r.status === 'pending' || (r.status === 'countered' && r.from === 'buyer')).length;
export const respondOffer = (ownerId, id, action, amount) => {
  const arr = getOffers(ownerId);
  let tgt = null;
  arr.forEach((r) => {
    if (r.id !== id) return;
    tgt = r;
    r.history = r.history || [];
    r.history.push({ amount: r.amount, by: r.from, at: Date.now() });
    if (action === 'accept') r.status = 'accepted';
    else if (action === 'decline') r.status = 'declined';
    else if (action === 'counter') { r.amount = amount; r.from = 'owner'; r.status = 'countered'; }
    else if (action === 'buyer_counter') { r.amount = amount; r.from = 'buyer'; r.status = 'countered'; }
    r.updatedAt = Date.now();
  });
  saveOffers(ownerId, arr);
  return tgt;
};

