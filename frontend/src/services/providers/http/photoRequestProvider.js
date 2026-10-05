import { get, patch, post, unwrapFullPage } from '../../http.js';
import { MAX_PAGE_SIZE } from '../../apiLimits.js';

/** Duplicate asks are no-ops, not 409s, so happy paths do not use failure handlers. */
export async function requestPhotos(propertyIdOrSlug) {
  return post(`/properties/${encodeURIComponent(propertyIdOrSlug)}/photo-requests`);
}

/** The owner's inbox, newest first. */
export async function myPhotoRequests({ page = 0, size = MAX_PAGE_SIZE } = {}) {
  const res = await get('/me/photo-requests', { page, size });
  const items = unwrapFullPage(res, 'photo-request');
  return {
    items,
    page: res?.page ?? res?.number ?? page,
    size: res?.size ?? size,
    total: res?.totalElements ?? items.length,
    totalPages: res?.totalPages ?? 0,
  };
}

/** The body is mandatory: there are two transitions, so the decision is a required field and a call without it is a
 * 400. This is not a place where an omitted argument degrades to a default. */
export async function decidePhotoRequest(reqId, decision) {
  return patch(`/me/photo-requests/${encodeURIComponent(reqId)}`, { decision });
}
