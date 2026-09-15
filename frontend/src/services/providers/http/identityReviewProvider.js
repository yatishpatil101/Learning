import { get, post, unwrapPage } from '../../http.js';

const reviewPath = (id) => `/moderation/identity-reviews/${encodeURIComponent(id)}`;

const parseTime = (value) => (value ? Date.parse(value) || null : null);

function mapReview(row) {
  return {
    ...row,
    submittedAt: parseTime(row?.submittedAt),
    decidedAt: parseTime(row?.decidedAt),
    filesPurgedAt: parseTime(row?.filesPurgedAt),
  };
}

export async function listIdentityReviews({ status = 'pending', page = 0, size = 20 } = {}) {
  const res = await get('/moderation/identity-reviews', { status, page, size });
  const unwrapped = unwrapPage(res, { page, size });
  return { ...unwrapped, items: unwrapped.items.map(mapReview) };
}

export async function getIdentityReview(id) {
  return mapReview(await get(reviewPath(id)));
}

export async function approveIdentityReview(id, payload) {
  return mapReview(await post(`${reviewPath(id)}/approve`, payload));
}

export async function rejectIdentityReview(id, payload) {
  return mapReview(await post(`${reviewPath(id)}/reject`, payload));
}