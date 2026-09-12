/**
 * HTTP review provider.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `reviewService.js` is the
 * only contract between them and no page may care which one is active. Shape translation lives in
 * `reviewMapper.js`.
 *
 * This is one of the thinner providers — four requests and no client-side state — because the
 * server already models reviews the way the UI wanted them. The interesting decisions were made in
 * the contract (see `reviewMapper.js` on `context`), not here.
 */
import { get, patch, post } from '../../http.js';
import {
  toModerationViewModelPage,
  toReviewCreate,
  toSummaryViewModel,
  toViewModel,
  toViewModelListPage,
  toViewModelPage,
} from './reviewMapper.js';

/**
 * One large page rather than real paging — for the *entity* routes only.
 *
 * No longer load-bearing for the numbers: the locality, society and owner surfaces read their
 * average, count and per-aspect means from `getEntityReviewSummary`, which aggregates in SQL over
 * every published review. What is still at stake is the *cards*, and neither surface has paging
 * controls to reach page 2 with — so a truncated fetch means reviews nobody can ever read.
 *
 * 100 is the server's hard ceiling (`spring.data.web.pageable.max-page-size`); asking for more is
 * silently clamped, which is why `warnIfTruncated` compares against the rows actually returned
 * rather than against this constant. A locality with more than 100 reviews is a real possibility,
 * and the warning is what turns "some reviews seem to be missing" into a reported bug instead of a
 * shrug.
 */
const PAGE_SIZE = 100;

/**
 * Reviews of one listing — `GET /properties/{propId}/reviews`, unpaged, a bare array.
 *
 * **This used to request `/reviews/property/{id}`, which is not a route.** That URI matches
 * `GET /reviews/{entityType}/{entityId}`, whose `entityType` is `enum: [society, locality, owner]`,
 * so `ReviewTargetKey` rejected `property` and every live read 404'd. The property page catches a
 * failed review read and renders an unreviewed listing, so the whole thing presented as "no reviews
 * yet" — a correct-looking page, on every listing, for as long as it went unnoticed. Nothing caught
 * it because `review-parity.mjs` exercises only the entity route, where reviews need no eligibility.
 *
 * `propertyId` must be the listing's **UUID**: this path binds `@PathVariable UUID propId`, and the
 * seam's `p.id` is the slug. Callers resolve that with `p.uuid || p.id` — see `ReviewsSection.jsx`.
 */
export async function listPropertyReviews(propertyId) {
  return toViewModelListPage(await get(`/properties/${encodeURIComponent(propertyId)}/reviews`));
}

/**
 * The server-computed rating summary for one listing (D79).
 *
 * The point of the endpoint is that it does not load a single review: the average, the star
 * distribution and the per-aspect averages come from two aggregate queries. Reducing the list to
 * get them — which is what the page did, and why the list may not be paged — meant downloading
 * every review of a listing to draw one number next to a star.
 */
export async function getPropertyReviewSummary(propertyId) {
  return toSummaryViewModel(
    await get(`/properties/${encodeURIComponent(propertyId)}/reviews/summary`),
  );
}

export async function createPropertyReview(propertyId, review) {
  const created = await post(
    `/properties/${encodeURIComponent(propertyId)}/reviews`,
    toReviewCreate(review),
  );
  return toViewModel(created);
}

export async function listEntityReviews(entityType, entityId, { page = 0, size = PAGE_SIZE } = {}) {
  const res = await get(
    `/reviews/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    { page, size },
  );
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

/**
 * The server-computed rating summary for a society, locality or owner (D79, entity half).
 *
 * Note the route shape: `/reviews/{entityType}/{entityId}/summary`, built the same way
 * `listEntityReviews` builds its path. That similarity is deliberate — the property routes once
 * pointed at `/reviews/property/{id}`, which *looks* like this pattern but matches
 * `/reviews/{entityType}/{entityId}` with an `entityType` the server rejects, so every live
 * property-review read 404'd for weeks while the page rendered "no reviews yet". Here `entityType`
 * really is one of `society | locality | owner`, and anything else is a 404 the caller must show as
 * unavailable rather than swallow.
 *
 * This is the read that fixes the actual bug: `listEntityReviews` is paged at 20 server-side, so
 * every caller reducing it has been averaging page one.
 */
export async function getEntityReviewSummary(entityType, entityId) {
  return toSummaryViewModel(
    await get(
      `/reviews/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/summary`,
    ),
    entityType,
  );
}

/**
 * The moderation queue — `GET /admin/reviews`, paged, staff-only.
 *
 * The one review read that does **not** filter on `status`, which is the whole reason it needs its
 * own route rather than a query parameter on the public one: a moderator has to see the review that
 * has already been taken down, and a public endpoint that could be asked for rejected rows would be
 * one forgotten `@PreAuthorize` away from serving them to anyone.
 *
 * Reviews are post-moderated, so there is no pending backlog by default and the unfiltered call —
 * everything, newest first — is the useful one. `status: 'rejected'` answers "what has been taken
 * down", which is the other question a moderator actually asks.
 *
 * Genuinely paged, unlike `listEntityReviews`. The console draws paging controls, so page 2 is
 * reachable and a large fetch would buy nothing; the server's default of 20 is the page size the
 * table was already using.
 */
export async function listReviewsForModeration({ status, page = 0, size = 20 } = {}) {
  const res = await get('/admin/reviews', { status: status || undefined, page, size });
  return toModerationViewModelPage(res, { page, size });
}

/**
 * Publish or take down one review — `PATCH /reviews/{id}/status`.
 *
 * Returns nothing, because the server returns nothing: the verdict is the whole effect and there is
 * no updated representation worth round-tripping. Callers await it before touching their own state,
 * so a refused write cannot leave an optimistic row claiming a decision nobody made.
 *
 * `status` must be `published` or `rejected`. `pending` is the intake state, not a verdict, and the
 * server refuses it with a 400 — there is no route back to "undecided" once a human has looked.
 *
 * `reason` is optional and is written to the audit log rather than shown to the author. It is the
 * only record of *why* a review came down, so it is passed through unmodified and untrimmed.
 */
export async function setReviewStatus(id, status, reason) {
  await patch(`/reviews/${encodeURIComponent(id)}/status`, { status, reason: reason || undefined });
}

/**
 * Say so when the corpus is larger than the page the cards are drawn from.
 *
 * Silence here would mean a locality quietly hiding reviews as it gets popular — the failure mode
 * that gets *more* likely the more the platform succeeds, and the one nobody reproduces because it
 * needs a hundred reviews to appear.
 *
 * No page on the client computes an aggregate from this list any more: the property page reads
 * `getPropertyReviewSummary` and the three entity surfaces read `getEntityReviewSummary`, both of
 * which aggregate in SQL over every published review rather than over whatever was fetched.
 */
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
