/**
 * Mock deal provider — wraps store.js deal/finalization/offer functions
 */
import {
  getDeals as _getDeals,
  getDeal as _getDeal,
  isDealClosed as _isDealClosed,
  dealStatus as _dealStatus,
  isDealReserved as _isDealReserved,
  closeDeal as _closeDeal,
  reopenDeal as _reopenDeal,
  markUnderOffer as _markUnderOffer,
  getUnderOfferParties as _getUnderOfferParties,
  addUnderOfferParty as _addUnderOfferParty,
  removeUnderOfferParty as _removeUnderOfferParty,
  getDealReqs as _getDealReqs,
  requestFinalize as _requestFinalize,
  myFinalizeStatus as _myFinalizeStatus,
  cancelFinalize as _cancelFinalize,
  pendingFinalizeFor as _pendingFinalizeFor,
  pendingFinalizeCount as _pendingFinalizeCount,
  acceptFinalize as _acceptFinalize,
  declineFinalize as _declineFinalize,
  getOffers as _getOffers,
  addOffer as _addOffer,
  myOffer as _myOffer,
  offersFor as _offersFor,
  pendingOfferCount as _pendingOfferCount,
  respondOffer as _respondOffer,
} from '../../../lib/store.js';

// Deals
export const getDeals = (ownerMobile) => Promise.resolve(_getDeals(ownerMobile));
export const getDeal = (ownerMobile, propId) => Promise.resolve(_getDeal(ownerMobile, propId));
export const isDealClosed = (ownerMobile, propId) => Promise.resolve(_isDealClosed(ownerMobile, propId));
export const dealStatus = (ownerMobile, propId) => Promise.resolve(_dealStatus(ownerMobile, propId));
export const isDealReserved = (ownerMobile, propId) => Promise.resolve(_isDealReserved(ownerMobile, propId));
export const closeDeal = (ownerMobile, propId, deal, closedWith) => Promise.resolve(_closeDeal(ownerMobile, propId, deal, closedWith));
export const reopenDeal = (ownerMobile, propId) => Promise.resolve(_reopenDeal(ownerMobile, propId));
export const markUnderOffer = (ownerMobile, propId, deal, parties) => Promise.resolve(_markUnderOffer(ownerMobile, propId, deal, parties));
export const getUnderOfferParties = (ownerMobile, propId) => Promise.resolve(_getUnderOfferParties(ownerMobile, propId));
export const addUnderOfferParty = (ownerMobile, propId, party) => Promise.resolve(_addUnderOfferParty(ownerMobile, propId, party));
export const removeUnderOfferParty = (ownerMobile, propId, idx) => Promise.resolve(_removeUnderOfferParty(ownerMobile, propId, idx));

// Finalization (maker-checker)
export const getDealReqs = (ownerMobile) => Promise.resolve(_getDealReqs(ownerMobile));
export const requestFinalize = (ownerMobile, propId, deal) => Promise.resolve(_requestFinalize(ownerMobile, propId, deal));
export const myFinalizeStatus = (ownerMobile, propId) => Promise.resolve(_myFinalizeStatus(ownerMobile, propId));
export const cancelFinalize = (ownerMobile, propId) => Promise.resolve(_cancelFinalize(ownerMobile, propId));
export const pendingFinalizeFor = (ownerMobile, propId) => Promise.resolve(_pendingFinalizeFor(ownerMobile, propId));
export const pendingFinalizeCount = (ownerMobile) => Promise.resolve(_pendingFinalizeCount(ownerMobile));
export const acceptFinalize = (ownerMobile, reqId, meta) => Promise.resolve(_acceptFinalize(ownerMobile, reqId, meta));
export const declineFinalize = (ownerMobile, reqId) => Promise.resolve(_declineFinalize(ownerMobile, reqId));

// Offers
export const getOffers = (ownerMobile) => Promise.resolve(_getOffers(ownerMobile));
export const addOffer = (ownerMobile, o) => Promise.resolve(_addOffer(ownerMobile, o));
export const myOffer = (ownerMobile, propId) => Promise.resolve(_myOffer(ownerMobile, propId));
export const offersFor = (ownerMobile, propId) => Promise.resolve(_offersFor(ownerMobile, propId));
export const pendingOfferCount = (ownerMobile) => Promise.resolve(_pendingOfferCount(ownerMobile));
export const respondOffer = (ownerMobile, id, action, amount) => Promise.resolve(_respondOffer(ownerMobile, id, action, amount));
