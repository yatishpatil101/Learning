import { get, patch, post } from '../../http.js';
import {
  toModerationViewModelPage,
  toReviewCreate,
  toSummaryViewModel,
  toViewModel,
  toViewModelPage,
} from './reviewMapper.js';

/** One large page since entity surfaces have no paging controls. 100 is the server's ceiling and larger
 * sizes are clamped silently, so `warnIfTruncated` compares against rows returned. */
const PAGE_SIZE = 100;

/** Window in which the list and summary reads of one target share a single request. */
const SHARED_READ_TTL_MS = 5_000;

// A missing summary is a failed read, never a zero-review one: callers render the two differently.
function summaryOf(res) {
  if (!res?.summary) throw new Error('Review list response carried no summary.');
  return res.summary;
}

const propertyReviews = (propertyId) =>
  get(`/properties/${encodeURIComponent(propertyId)}/reviews`, undefined, { ttl: SHARED_READ_TTL_MS });

const entityReviews = (entityType, entityId, { page = 0, size = PAGE_SIZE } = {}) =>
  get(
    `/reviews/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    { page, size },
    { ttl: SHARED_READ_TTL_MS },
  );

/** Reviews of one listing (`GET /properties/{propId}/reviews`), not `/reviews/property/{id}`, which 404s because `entityType` excludes `property`.
 * `propertyId` must be the listing UUID (`p.uuid || p.id`), since the path binds `UUID propId`. */
export async function listPropertyReviews(propertyId) {
  return toViewModelPage(await propertyReviews(propertyId));
}

/** The rating summary of the same response `listPropertyReviews` reads, so asking for both costs one request. */
export async function getPropertyReviewSummary(propertyId) {
  return toSummaryViewModel(summaryOf(await propertyReviews(propertyId)));
}

export async function createPropertyReview(propertyId, review) {
  const created = await post(
    `/properties/${encodeURIComponent(propertyId)}/reviews`,
    toReviewCreate(review),
  );
  return toViewModel(created);
}

export async function listEntityReviews(entityType, entityId, { page = 0, size = PAGE_SIZE } = {}) {
  const res = await entityReviews(entityType, entityId, { page, size });
  warnIfTruncated(res, `${entityType} ${entityId}`);
  return toViewModelPage(res, { page, size });
}

export async function createEntityReview(entityType, entityId, review) {
  const created = await post(
    `/reviews/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    toReviewCreate(review),
  );
  return toViewModel(created);
}

/** The rating summary of the same response `listEntityReviews` reads; it covers every published review. An `entityType`
 * outside `society | locality | owner` is a 404 the caller must show as unavailable. */
export async function getEntityReviewSummary(entityType, entityId) {
  return toSummaryViewModel(summaryOf(await entityReviews(entityType, entityId)), entityType);
}

/** The staff moderation queue (`GET /admin/reviews`, paged): the one review read that does not filter on `status`, so it needs its own route
 * and a moderator can see taken-down reviews; `status: 'rejected'` lists those. */
export async function listReviewsForModeration({ status, page = 0, size = 20 } = {}) {
  const res = await get('/admin/reviews', { status: status || undefined, page, size });
  return toModerationViewModelPage(res, { page, size });
}

/** `PATCH /reviews/{id}/status`: `published` or `rejected` only (server 400s `pending`); `reason` goes untrimmed to the audit log. */
export async function setReviewStatus(id, status, reason) {
  await patch(`/reviews/${encodeURIComponent(id)}/status`, { status, reason: reason || undefined });
}

/* Silent truncation would hide reviews exactly as a locality gets popular. Aggregates never come
   from this list — the summary endpoints compute them in SQL. */
function warnIfTruncated(res, what) {
  const returned = Array.isArray(res?.content) ? res.content.length : 0;
  const total = res?.totalElements ?? returned;
  if (total > returned) {
    console.warn(
      `[reviews] ${what} has ${total} reviews but only ${returned} were fetched. The cards below ` +
        'are page one and this surface has no control to reach page two, so the rest are ' +
        'unreadable. Paging is needed here.',
    );
  }
}
