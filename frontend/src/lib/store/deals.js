import { readUser } from '../auth.js';
import { digits, myMobile } from '../contact.js';
import { get, parseAmount, set } from './internals.js';
import { addTenancy } from './rent.js';

/* =========================================================================
   Deals: a closed property is no longer active for other users.
   Lifecycle: 'active' (no entry) -> 'reserved' (Under Offer) -> 'closed'.
   ========================================================================= */
const dealKey = (ownerMobile) => 'puneNestDeals:' + (digits(ownerMobile) || 'anon');
export const getDeals = (ownerMobile) => get(dealKey(ownerMobile), {});
export const getDeal = (ownerMobile, propId) => getDeals(ownerMobile)[propId || ''] || null;
export const isDealClosed = (ownerMobile, propId) => {
  const d = getDeal(ownerMobile, propId);
  return !!(d && d.status === 'closed');
};
export const dealStatus = (ownerMobile, propId) => {
  const d = getDeal(ownerMobile, propId);
  return d && (d.status === 'closed' || d.status === 'reserved') ? d.status : 'active';
};
export const isDealReserved = (ownerMobile, propId) => dealStatus(ownerMobile, propId) === 'reserved';
export const closeDeal = (ownerMobile, propId, deal, closedWith) => {
  if (!propId) return;
  const all = getDeals(ownerMobile);
  const prev = all[propId] || {};
  all[propId] = { status: 'closed', deal: deal || prev.deal || 'buy', at: Date.now(), closedWith: closedWith || null };
  set(dealKey(ownerMobile), all);
};
export const reopenDeal = (ownerMobile, propId) => {
  const all = getDeals(ownerMobile);
  delete all[propId || ''];
  set(dealKey(ownerMobile), all);
};
export const markUnderOffer = (ownerMobile, propId, deal, parties) => {
  if (!propId) return;
  const all = getDeals(ownerMobile);
  const prev = all[propId] || {};
  all[propId] = {
    status: 'reserved',
    deal: deal || prev.deal || 'buy',
    at: prev.status === 'reserved' && prev.at ? prev.at : Date.now(),
    parties: parties != null ? parties : prev.parties || [],
  };
  set(dealKey(ownerMobile), all);
  return all[propId];
};
export const getUnderOfferParties = (ownerMobile, propId) => {
  const d = getDeal(ownerMobile, propId);
  return (d && d.parties) || [];
};
export const addUnderOfferParty = (ownerMobile, propId, party) => {
  if (!propId || !party) return;
  let all = getDeals(ownerMobile);
  let d = all[propId];
  if (!d || d.status !== 'reserved') {
    markUnderOffer(ownerMobile, propId);
    all = getDeals(ownerMobile);
  }
  all[propId].parties = all[propId].parties || [];
  all[propId].parties.push({ name: party.name || 'Interested party', note: party.note || '', mobile: digits(party.mobile || ''), at: Date.now() });
  set(dealKey(ownerMobile), all);
  return all[propId].parties;
};
export const removeUnderOfferParty = (ownerMobile, propId, idx) => {
  const all = getDeals(ownerMobile);
  const d = all[propId];
  if (!d || !d.parties) return;
  d.parties.splice(idx, 1);
  set(dealKey(ownerMobile), all);
  return d.parties;
};

/* =========================================================================
   Maker-checker finalization: buyer requests, owner confirms/declines.
   ========================================================================= */
const dealReqKey = (ownerMobile) => 'puneNestDealReq:' + (digits(ownerMobile) || 'anon');
export const getDealReqs = (ownerMobile) => get(dealReqKey(ownerMobile), []);
export const saveDealReqs = (ownerMobile, arr) => set(dealReqKey(ownerMobile), arr);
export const requestFinalize = (ownerMobile, propId, deal) => {
  const u = readUser();
  if (!u) return 'login';
  const mine = digits(u.mobile);
  const reqs = getDealReqs(ownerMobile);
  if (reqs.filter((r) => r.propId === (propId || '') && r.buyerMobile === mine && r.status === 'pending')[0]) return 'pending';
  reqs.unshift({ id: 'f' + Date.now(), propId: propId || '', deal: deal || 'buy', buyerName: u.name || 'Buyer', buyerMobile: mine, status: 'pending', at: Date.now() });
  saveDealReqs(ownerMobile, reqs);
  return 'pending';
};
export const myFinalizeStatus = (ownerMobile, propId) => {
  const mine = myMobile();
  if (!mine) return 'none';
  const reqs = getDealReqs(ownerMobile).filter((r) => r.propId === (propId || '') && r.buyerMobile === mine);
  return reqs.length ? reqs[0].status : 'none';
};
export const cancelFinalize = (ownerMobile, propId) => {
  const mine = myMobile();
  const reqs = getDealReqs(ownerMobile).filter((r) => !(r.propId === (propId || '') && r.buyerMobile === mine && r.status === 'pending'));
  saveDealReqs(ownerMobile, reqs);
};
export const pendingFinalizeFor = (ownerMobile, propId) =>
  getDealReqs(ownerMobile).filter((r) => r.propId === (propId || '') && r.status === 'pending');
export const pendingFinalizeCount = (ownerMobile) =>
  getDealReqs(ownerMobile).filter((r) => r.status === 'pending').length;
export const acceptFinalize = (ownerMobile, reqId, meta) => {
  const reqs = getDealReqs(ownerMobile);
  let target = null;
  reqs.forEach((r) => {
    if (r.id === reqId) {
      r.status = 'accepted';
      target = r;
    }
  });
  if (target) reqs.forEach((r) => { if (r.propId === target.propId && r.status === 'pending') r.status = 'declined'; });
  saveDealReqs(ownerMobile, reqs);
  if (target) {
    meta = meta || {};
    const dealKind = meta.deal || target.deal || 'buy';
    const rent = meta.rent != null ? parseAmount(meta.rent) : 0;
    closeDeal(ownerMobile, target.propId, dealKind, {
      name: target.buyerName,
      mobile: digits(target.buyerMobile),
      rent,
      title: meta.title || '',
      address: meta.address || '',
    });
    if (dealKind === 'rent') {
      addTenancy(target.buyerMobile, {
        ownerMobile: digits(ownerMobile),
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
export const declineFinalize = (ownerMobile, reqId) => {
  const reqs = getDealReqs(ownerMobile);
  reqs.forEach((r) => { if (r.id === reqId) r.status = 'declined'; });
  saveDealReqs(ownerMobile, reqs);
};

/* =========================================================================
   In-app offers / negotiation (per owner)
   ========================================================================= */
const offerKey = (ownerMobile) => 'pnOffers:' + (digits(ownerMobile) || 'anon');
export const getOffers = (ownerMobile) => get(offerKey(ownerMobile), []);
export const saveOffers = (ownerMobile, arr) => set(offerKey(ownerMobile), arr);
export const addOffer = (ownerMobile, o) => {
  const u = readUser();
  if (!u) return 'login';
  const arr = getOffers(ownerMobile);
  const rec = Object.assign({ id: 'of' + Date.now(), buyerName: u.name || 'Buyer', buyerMobile: digits(u.mobile), status: 'pending', from: 'buyer', at: Date.now(), history: [] }, o || {});
  arr.unshift(rec);
  saveOffers(ownerMobile, arr);
  return rec;
};
export const myOffer = (ownerMobile, propId) => {
  const mine = myMobile();
  return getOffers(ownerMobile).filter((r) => r.propId === (propId || '') && r.buyerMobile === mine)[0] || null;
};
export const offersFor = (ownerMobile, propId) =>
  getOffers(ownerMobile).filter((r) => propId == null || r.propId === propId);
export const pendingOfferCount = (ownerMobile) =>
  getOffers(ownerMobile).filter((r) => r.status === 'pending' || (r.status === 'countered' && r.from === 'buyer')).length;
export const respondOffer = (ownerMobile, id, action, amount) => {
  const arr = getOffers(ownerMobile);
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
  saveOffers(ownerMobile, arr);
  return tgt;
};

