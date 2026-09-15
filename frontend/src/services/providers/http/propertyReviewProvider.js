/**
 * Property verification — the owner↔ops case file behind a listing's approval. `{id}` is the UUID,
 * never the slug; access is participant-or-staff and a stranger is answered 404 rather than 403.
 */
import { ApiError, del, get, patch, post, unwrapPage } from '../../http.js';
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { toCaseFile, toQueueRow } from './propertyReviewMapper.js';

const caseFilePath = (propertyId) => `/properties/${encodeURIComponent(propertyId)}/verification`;
const ownershipPath = (propertyId) => `${caseFilePath(propertyId)}/ownership`;

/** Keep the raw response: verified, verifiedAt, verifiedUntil, missingKinds and evidence. */
export function getOwnershipVerification(propertyId) {
  return get(ownershipPath(propertyId));
}

/** Raw DocumentDto[]: id, propertyId, category, fileName, url, sizeBytes, mimeType, uploadedAt. */
export function listOwnershipDocuments(propertyId) {
  return get(`${ownershipPath(propertyId)}/documents`);
}

/** `issuedOn` is the document's own calendar date (YYYY-MM-DD), not the upload or review time. */
export function recordOwnershipEvidence(propertyId, { docType, documentId, issuedOn, subjectName }) {
  return post(`${ownershipPath(propertyId)}/evidence`, { docType, documentId, issuedOn, subjectName });
}

export function verifyOwnership(propertyId) {
  return post(ownershipPath(propertyId));
}

/** A query parameter survives proxies that discard DELETE bodies. */
export function revokeOwnershipVerification(propertyId, reason) {
  return del(ownershipPath(propertyId), { query: { reason } });
}

/**
 * Read the case file, or `null` when this listing has never been submitted. A 404 is the normal
 * answer here, and "no case" and "not visible to you" render the same empty state either way.
 */
export async function getPropertyReview(propertyId) {
  try {
    return toCaseFile(await get(caseFilePath(propertyId)));
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Idempotent open avoids a GET-then-POST race between reviewers; an existing case stays untouched.
 * Rejected cases are not reopened by this call. The server seeds the per-deal checklist.
 */
export async function startPropertyReview(propertyId) {
  return toCaseFile(await post(caseFilePath(propertyId)));
}

/**
 * Post a message; the server attributes the sender and answers with the whole case file, so a
 * decision taken between render and send shows up in the reply. Attachments go to the vault route.
 */
export async function addPropertyReviewMessage(propertyId, body) {
  return toCaseFile(await post(`${caseFilePath(propertyId)}/messages`, { body }));
}

/**
 * Mark the other side's messages read. 204, so there is nothing to map.
 *
 * "The other side" is resolved server-side so a caller cannot clear another reader's unread flag.
 */
export async function markPropertyReviewRead(propertyId) {
  await post(`${caseFilePath(propertyId)}/read`);
}

/**
 * Tick one checklist line, addressed by its text — the rows are seeded and immutable, so there is
 * no id. PATCH one line at a time, because a whole-list write races a second reviewer.
 */
export async function setPropertyReviewChecklistItem(propertyId, item, pass) {
  const body = { item, pass: Boolean(pass) };
  return toCaseFile(await patch(`${caseFilePath(propertyId)}/checklist`, body));
}

/**
 * @param decision `approve` or `reject`; the server atomically updates case, listing and thread
 * @param note     rejection reason shown to the owner; blank falls back to the server's sentence
 */
export async function decidePropertyReview(propertyId, decision, note) {
  const input = String(decision ?? '').toLowerCase();
  const approve = input.startsWith('approve');
  if (!approve && !input.startsWith('reject')) {
    throw new ApiError({
      code: 'bad_request',
      status: 400,
      message: 'decision must be approve or reject',
    });
  }
  const verb = approve ? 'approve' : 'reject';
  return toCaseFile(await post(`${caseFilePath(propertyId)}/decision`, { decision: verb, note }));
}

/**
 * The verification queue, newest activity first. The server offers no filter, so none is accepted
 * here rather than quietly dropped; `size` is clamped because a truncated page desyncs the count.
 */
export async function listPropertyReviewQueue({ page = 0, size = 20 } = {}) {
  const capped = Math.min(size, MAX_PAGE_SIZE);
  const res = await get('/admin/property-reviews', { page, size: capped });
  const unwrapped = unwrapPage(res, { page, size: capped });
  return { ...unwrapped, items: unwrapped.items.map(toQueueRow) };
}

/**
 * The caller's own queue avoids per-listing status requests; an owner with no listings gets [].
 * `unread` counts ops messages not yet read by the owner, the mirror of the staff queue.
 */
export async function listMyPropertyReviews({ page = 0, size = 20 } = {}) {
  const capped = Math.min(size, MAX_PAGE_SIZE);
  const res = await get('/me/property-reviews', { page, size: capped });
  const unwrapped = unwrapPage(res, { page, size: capped });
  return { ...unwrapped, items: unwrapped.items.map(toQueueRow) };
}
