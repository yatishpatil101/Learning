/* Offer books are token-scoped; accepting an owner id would imply enumeration is allowed. */
import { del, get, post, unwrapFullPage } from '../../http.js';
// Leaf module, no imports of its own — see its header. Deliberately not from `http.js`.
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
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

/** Keep pages capped uniformly without adding unused pager shapes to callers. */
const paged = () => ({ size: MAX_PAGE_SIZE });

/** Missing deal rows synthesize `active`, so successful responses are always documents. */
export async function getDeal(propId) {
  if (!signedIn() || !propId) return null;
  return toDealViewModel(await get(`/me/deals/${encodeURIComponent(propId)}`));
}

/** Property cards already carry deal status; stale offers still fail server-side with 409. */
export async function dealStatusForBuyer(property) {
  return property?.dealStatus || 'active';
}

/** `POST /me/deals/{propId}/reserve` — mark the listing under offer. 409 on an illegal transition. */
export async function reserveDeal(propId) {
  await post(`/me/deals/${encodeURIComponent(propId)}/reserve`, {});
}

/** `agreedPrice` and `counterpartyMobile` are **required and validated**: the price must be positive and the mobile
 * must be ten digits. */
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

/** That is surfaced rather than smoothed over: a call site written against gentler behaviour would break the first
 * time a buyer double-submitted. */
export async function submitOffer(req = {}) {
  return toOfferViewModel(await post('/offers', {
    propertyId: req.propId || req.propertyId,
    amount: Number(req.amount) || 0,
    message: req.message || undefined,
    moveIn: req.moveIn || undefined,
  }));
}

/** **Accept and decline are the owner's alone.** A buyer attempting either gets 403, by design. */
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

/** `GET /offers/mine` — offers the caller **made**, newest first. Paged. */
export async function myOffers() {
  if (!signedIn()) return [];
  return unwrapFullPage(await get('/offers/mine', paged()), 'offer').map(toOfferViewModel);
}

/** `GET /me/offers` — offers **on** the caller's own listings, newest first. Paged. */
export async function offersOnMine() {
  if (!signedIn()) return [];
  return unwrapFullPage(await get('/me/offers', paged()), 'offer').map(toOfferViewModel);
}

/** Finalization requires counterparty mobile and a positive agreed price. */
export async function requestFinalization(propId, { counterpartyMobile, agreedPrice } = {}) {
  return toFinalizationViewModel(
    await post(`/finalization/${encodeURIComponent(propId)}/request`, {
      propertyId: propId,
      counterpartyMobile: String(counterpartyMobile || '').replace(/\D/g, ''),
      agreedPrice: Number(agreedPrice) || 0,
    }),
  );
}

/** **404 is still a normal answer here.** The endpoint 404s when the caller has never had a request on this property
 * — the ordinary state of every listing nobody has proposed to close. */
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

/** A per-property variant would be a second endpoint answering a subset of this one. */
export async function myFinalizationRequests() {
  if (!signedIn()) return [];
  const rows = unwrapFullPage(await get('/me/finalization-requests', paged()), 'finalization');
  return rows.map(toFinalizationViewModel).filter(Boolean);
}

export async function acceptFinalization(reqId) {
  await post(`/finalization/requests/${encodeURIComponent(reqId)}/accept`, {});
}

/** `POST /finalization/requests/{reqId}/decline` — the counterparty refuses. */
export async function declineFinalization(reqId) {
  await post(`/finalization/requests/${encodeURIComponent(reqId)}/decline`, {});
}
