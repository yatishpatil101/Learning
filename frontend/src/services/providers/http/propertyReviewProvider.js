/** `{id}` is the UUID, never the slug; a non-participant gets 404 rather than 403. */
import { ApiError, PAGE_LOAD_TTL, del, get, patch, post, unwrapPage } from '../../http.js';
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { toCaseFile, toQueueRow } from './propertyReviewMapper.js';

const caseFilePath = (propertyId) => `/properties/${encodeURIComponent(propertyId)}/verification`;
const ownershipPath = (propertyId) => `${caseFilePath(propertyId)}/ownership`;
export const OVERRIDE_REQUESTS_ENABLED = true;

/** Keep the raw response: verified, verifiedAt, verifiedUntil, missingKinds and evidence. */
export function getOwnershipVerification(propertyId) {
  return get(ownershipPath(propertyId));
}

/** Raw DocumentDto[]: id, propertyId, category, fileName, url, sizeBytes, mimeType, uploadedAt. */
export function listOwnershipDocuments(propertyId) {
  return get(`${ownershipPath(propertyId)}/documents`);
}

/** `issuedAt` is the document's own instant, not the upload or review time. */
export function recordOwnershipEvidence(propertyId, { docType, documentId, issuedAt, issuedOn, subjectName }) {
  return post(`${ownershipPath(propertyId)}/evidence`, { docType, documentId, issuedAt, issuedOn, subjectName });
}

export function verifyOwnership(propertyId) {
  return post(ownershipPath(propertyId));
}

/** A query parameter survives proxies that discard DELETE bodies. */
export function revokeOwnershipVerification(propertyId, reason) {
  return del(ownershipPath(propertyId), { query: { reason } });
}

export function requestOwnershipVerification(propertyId) {
  return post(`${ownershipPath(propertyId)}/request`);
}

export function declineOwnershipVerification(propertyId, reason) {
  return post(`${ownershipPath(propertyId)}/decline`, { reason });
}

export async function getPropertyReview(propertyId) {
  try {
    return toCaseFile(await get(caseFilePath(propertyId)));
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/** Idempotent open avoids a GET-then-POST race between reviewers; an existing case stays untouched. */
export async function startPropertyReview(propertyId) {
  return toCaseFile(await post(caseFilePath(propertyId)));
}

export async function addPropertyReviewMessage(propertyId, body, clarificationRequested = false) {
  return toCaseFile(await post(`${caseFilePath(propertyId)}/messages`, { body, clarificationRequested }));
}

/** "The other side" is resolved server-side so a caller cannot clear another reader's unread flag. */
export async function markPropertyReviewRead(propertyId) {
  await post(`${caseFilePath(propertyId)}/read`);
}

/** Tick one checklist line, addressed by its text — the rows are seeded and immutable, so there is no id. PATCH one
 * line at a time, because a whole-list write races a second reviewer. */
export async function setPropertyReviewChecklistItem(propertyId, item, pass) {
  const body = { item, pass: Boolean(pass) };
  return toCaseFile(await patch(`${caseFilePath(propertyId)}/checklist`, body));
}

export async function decidePropertyReview(propertyId, decision, options) {
  const input = String(decision ?? '').toLowerCase();
  const verb = input.startsWith('approve') ? 'approve'
    : input.startsWith('reject') ? 'reject'
    : input === 'needs_info' || input === 'needs-info' || input.startsWith('needs') ? 'needs_info'
    : null;
  if (!verb) {
    throw new ApiError({
      code: 'bad_request',
      status: 400,
      message: 'decision must be approve, needs_info or reject',
    });
  }
  const body = typeof options === 'object' && options !== null
    ? { decision: verb, reasonCode: options.reasonCode, note: options.note, expectedStatus: options.expectedStatus }
    : { decision: verb, note: options };
  return toCaseFile(await post(`${caseFilePath(propertyId)}/decision`, body));
}

export async function requestPropertyReviewOverride(propertyId, reason) {
  return toCaseFile(await post(`${caseFilePath(propertyId)}/override-requests`, { reason }));
}

export async function approvePropertyReviewOverride(propertyId, requestId, note) {
  const body = note ? { note } : {};
  return toCaseFile(await post(`${caseFilePath(propertyId)}/override-requests/${encodeURIComponent(requestId)}/approve`, body));
}

export async function listPropertyReviewQueue({ page = 0, size = 20, status, unread } = {}) {
  const capped = Math.min(size, MAX_PAGE_SIZE);
  const res = await get('/admin/property-reviews', { page, size: capped, ...(status ? { status } : {}), ...(unread ? { unread: true } : {}) });
  const unwrapped = unwrapPage(res, { page, size: capped });
  return { ...unwrapped, items: unwrapped.items.map(toQueueRow) };
}

export async function listMyPropertyReviews({ page = 0, size = 20 } = {}) {
  const capped = Math.min(size, MAX_PAGE_SIZE);
  const res = await get('/me/property-reviews', { page, size: capped }, { ttl: PAGE_LOAD_TTL });
  const unwrapped = unwrapPage(res, { page, size: capped });
  return { ...unwrapped, items: unwrapped.items.map(toQueueRow) };
}
