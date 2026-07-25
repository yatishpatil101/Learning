/**
 * Deal Service — deals, finalization (maker-checker), offers/negotiation.
 */
import { createProvider } from './config.js';

const provider = createProvider('deal');

// Deals
export const getDeals = (ownerMobile) => provider().getDeals(ownerMobile);
export const getDeal = (ownerMobile, propId) => provider().getDeal(ownerMobile, propId);
export const isDealClosed = (ownerMobile, propId) => provider().isDealClosed(ownerMobile, propId);
export const dealStatus = (ownerMobile, propId) => provider().dealStatus(ownerMobile, propId);
export const isDealReserved = (ownerMobile, propId) => provider().isDealReserved(ownerMobile, propId);
export const closeDeal = (ownerMobile, propId, deal, closedWith) => provider().closeDeal(ownerMobile, propId, deal, closedWith);
export const reopenDeal = (ownerMobile, propId) => provider().reopenDeal(ownerMobile, propId);
export const markUnderOffer = (ownerMobile, propId, deal, parties) => provider().markUnderOffer(ownerMobile, propId, deal, parties);
export const getUnderOfferParties = (ownerMobile, propId) => provider().getUnderOfferParties(ownerMobile, propId);
export const addUnderOfferParty = (ownerMobile, propId, party) => provider().addUnderOfferParty(ownerMobile, propId, party);
export const removeUnderOfferParty = (ownerMobile, propId, idx) => provider().removeUnderOfferParty(ownerMobile, propId, idx);

// Maker-checker finalization
export const getDealReqs = (ownerMobile) => provider().getDealReqs(ownerMobile);
export const requestFinalize = (ownerMobile, propId, deal) => provider().requestFinalize(ownerMobile, propId, deal);
export const myFinalizeStatus = (ownerMobile, propId) => provider().myFinalizeStatus(ownerMobile, propId);
export const cancelFinalize = (ownerMobile, propId) => provider().cancelFinalize(ownerMobile, propId);
export const pendingFinalizeFor = (ownerMobile, propId) => provider().pendingFinalizeFor(ownerMobile, propId);
export const pendingFinalizeCount = (ownerMobile) => provider().pendingFinalizeCount(ownerMobile);
export const acceptFinalize = (ownerMobile, reqId, meta) => provider().acceptFinalize(ownerMobile, reqId, meta);
export const declineFinalize = (ownerMobile, reqId) => provider().declineFinalize(ownerMobile, reqId);

// Offers & negotiation
export const getOffers = (ownerMobile) => provider().getOffers(ownerMobile);
export const addOffer = (ownerMobile, o) => provider().addOffer(ownerMobile, o);
export const myOffer = (ownerMobile, propId) => provider().myOffer(ownerMobile, propId);
export const offersFor = (ownerMobile, propId) => provider().offersFor(ownerMobile, propId);
export const pendingOfferCount = (ownerMobile) => provider().pendingOfferCount(ownerMobile);
export const respondOffer = (ownerMobile, id, action, amount) => provider().respondOffer(ownerMobile, id, action, amount);
