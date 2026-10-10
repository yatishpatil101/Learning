/** Closed deals stay closed in UI; the server still rejects stale offers with 409. */
import { createProvider } from './config.js';

const provider = createProvider('deal');

/** A listing with no deal row resolves to `active` rather than null. */
export const getDeal = async (propId) => (await provider()).getDeal(propId);

/** Takes the property view-model so the wire's {@code dealStatus} can be resolved without a second fetch. */
export const dealStatusForBuyer = async (property) => (await provider()).dealStatusForBuyer(property);

/** Mark the caller's listing under offer. 409 from a closed deal. */
export const reserveDeal = async (propId) => (await provider()).reserveDeal(propId);

/** **Requires** a positive `agreedPrice` and a real ten-digit `counterpartyMobile`; a masked number is rejected
 * rather than stored as somebody's identity. */
export const closeDeal = async (propId, body) => (await provider()).closeDeal(propId, body);

/** Reopen a closed or reserved deal. */
export const reopenDeal = async (propId) => (await provider()).reopenDeal(propId);

/** Off-platform interested parties on a reserved listing. */
export const listParties = async (propId) => (await provider()).listParties(propId);

/* Revisions answer the existing offer; `moveIn` is folded into `message` for the owner. */
export const submitOffer = async (req) => (await provider()).submitOffer(req);

/** `isOwner` gates accept/decline. Both providers throw rather than spend a round trip earning 403. */
export const respondOffer = async (id, action, counterAmount, opts) =>
  (await provider()).respondOffer(id, action, counterAmount, opts);

/** Offers the caller made. */
export const myOffers = async () => (await provider()).myOffers();
/** Offers on the caller's own listings. */
export const offersOnMine = async () => (await provider()).offersOnMine();

/** Propose to close. Requires the counterparty's mobile and a positive agreed price. */
export const requestFinalization = async (propId, body) => (await provider()).requestFinalization(propId, body);

/* Pending only: declined finalization is intentionally indistinguishable from never asked. */
export const finalizationStatus = async (propId) => (await provider()).finalizationStatus(propId);

/** Withdraw the caller's own request. */
export const cancelFinalization = async (propId) => (await provider()).cancelFinalization(propId);

/** Requests awaiting the caller's decision, across every property. Filter by `propId` client-side. */
export const myFinalizationRequests = async () => (await provider()).myFinalizationRequests();

/** Accept: closes the deal and auto-declines every sibling on the same property. */
export const acceptFinalization = async (reqId) => (await provider()).acceptFinalization(reqId);
export const declineFinalization = async (reqId) => (await provider()).declineFinalization(reqId);
