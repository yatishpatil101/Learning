import { del, get, post, unwrapPage } from '../../http.js';

const reviewPath = (id) => `/moderation/identity-reviews/${encodeURIComponent(id)}`;

const parseTime = (value) => (value ? Date.parse(value) || null : null);

function mapReview(row) {
  return {
    ...row,
    livenessChallenge: ['left', 'right', 'smile'].includes(row?.livenessChallenge) ? row.livenessChallenge : null,
    numberOverridden: Boolean(row?.numberOverridden),
    livenessSource: ['challenge', 'client'].includes(row?.livenessSource) ? row.livenessSource : null,
    submittedAt: parseTime(row?.submittedAt),
    decidedAt: parseTime(row?.decidedAt),
    claimedAt: parseTime(row?.claimedAt),
    filesPurgedAt: parseTime(row?.filesPurgedAt),
    revokedAt: parseTime(row?.revokedAt),
    qaSampledAt: parseTime(row?.qaSampledAt),
    qaReviewedAt: parseTime(row?.qaReviewedAt),
  };
}

function approvalPayload(payload) {
  const base = {
    number: payload?.number,
    name: payload?.name,
    poseConfirmed: Boolean(payload?.poseConfirmed),
    numberOverride: Boolean(payload?.numberOverride),
  };
  return payload?.yearOnly
    ? { ...base, birthYear: Number(payload?.birthYear) }
    : { ...base, dob: payload?.dob };
}

/** `page` is zero-based on the wire; filters are server predicates, never applied to a loaded page. */
export async function listIdentityReviews({ status = 'pending', page = 0, size = 10, ...filters } = {}) {
  const res = await get('/moderation/identity-reviews', { status, page, size, ...filters });
  const unwrapped = unwrapPage(res, { page, size });
  return { ...unwrapped, items: unwrapped.items.map(mapReview) };
}

export async function identityReviewSummary() {
  return get('/moderation/identity-reviews/summary');
}

export async function getIdentityReview(id) {
  return mapReview(await get(reviewPath(id)));
}

export async function claimIdentityReview(id) {
  return mapReview(await post(`${reviewPath(id)}/claim`, {}));
}

export async function releaseIdentityReview(id, { force = false } = {}) {
  await del(`${reviewPath(id)}/claim${force ? '?force=true' : ''}`);
}

export async function approveIdentityReview(id, payload) {
  return mapReview(await post(`${reviewPath(id)}/approve`, approvalPayload(payload)));
}

export async function rejectIdentityReview(id, payload) {
  return mapReview(await post(`${reviewPath(id)}/reject`, payload));
}

export async function revokeIdentityReview(id, reason) {
  return mapReview(await post(`${reviewPath(id)}/revoke`, { reason }));
}

export async function qaIdentityReview(id, payload) {
  return mapReview(await post(`${reviewPath(id)}/qa`, payload));
}