/**
 * HTTP photo-request provider.
 *
 * No mapper module alongside this one: the server's `PhotoRequestResponse` was designed against
 * this seam, so the only translation left is unwrapping Spring's page envelope. A mapper here would
 * be a file of identity functions.
 *
 * Nothing in this file sees an owner's phone number. The mock keyed photo requests by owner mobile;
 * the server derives the owner from the listing, which is what lets the create call take a listing
 * id and the inbox call take no argument at all.
 */
import { get, patch, post, unwrapPage } from '../../http.js';

/**
 * Ask for more photos. Always resolves on a repeat press — the server answers `created: false`
 * rather than a 409, because asking twice is a no-op, not an error, and a 409 would route the
 * caller's happy path through its failure handler.
 *
 * 401 and 400 propagate as-is: "sign in" and "this is your own listing" are both things the user
 * can act on, so neither may be flattened into a silent success.
 */
export async function requestPhotos(propertyIdOrSlug) {
  return post(`/properties/${encodeURIComponent(propertyIdOrSlug)}/photo-requests`);
}

/** The owner's inbox, newest first. */
export async function myPhotoRequests({ page = 0, size = 20 } = {}) {
  const res = await get('/me/photo-requests', { page, size });
  // `total` is `totalElements` — the whole result set, not this page — which is what any
  // "N requests" label depends on. See `unwrapPage` for why `page` is not read from Spring's
  // `number`, and why falling back to the *requested* page was the original bug.
  return unwrapPage(res, { page, size });
}

/** Counted server-side, so it stays correct past the first page (D78). */
export async function pendingPhotoRequestCount() {
  const res = await get('/me/photo-requests/pending-count');
  return res?.pending ?? 0;
}

/**
 * Answer one request, either way.
 *
 * <p>The body is mandatory. V117 shipped this as a bodyless PATCH — there was one transition and no
 * argument to it — and V118 added `declined`, which made the decision a required field. A call
 * without it is a 400, so this is not a place where an omitted argument degrades to a default.
 *
 * @param {string} reqId
 * @param {'resolved'|'declined'} decision
 */
export async function decidePhotoRequest(reqId, decision) {
  return patch(`/me/photo-requests/${encodeURIComponent(reqId)}`, { decision });
}
