/**
 * HTTP review provider — the live counterpart to `providers/mock/reviewProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `reviewService.js` is the
 * only contract between them and no page may care which one is active. Shape translation lives in
 * `reviewMapper.js`.
 *
 * This is one of the thinner providers — four requests and no client-side state — because the
 * server already models reviews the way the UI wanted them. The interesting decisions were made in
 * the contract (see `reviewMapper.js` on `context`), not here.
 */
import { get, post } from '../../http.js';
import { toReviewCreate, toViewModel, toViewModelPage } from './reviewMapper.js';

/**
 * One large page rather than real paging.
 *
 * Every consumer computes an aggregate over the whole list — the property page's average, star
 * distribution, per-category means and "% would recommend"; the locality and society blocks their
 * own averages. Those numbers are wrong if they are computed over page 1 of n, and none of these
 * surfaces has paging controls to reach page 2 with.
 *
 * 100 is the server's hard ceiling (`spring.data.web.pageable.max-page-size`); asking for more is
 * silently clamped, which is why `warnIfTruncated` compares against the rows actually returned
 * rather than against this constant. A property with more than 100 reviews is a real possibility
 * for a popular locality, and the warning is what turns "the average looks slightly off" into a
 * reported bug instead of a shrug.
 */
const PAGE_SIZE = 100;

export async function listPropertyReviews(propertyId, { page = 0, size = PAGE_SIZE } = {}) {
  const res = await get(`/reviews/property/${encodeURIComponent(propertyId)}`, { page, size });
  warnIfTruncated(res, `property ${propertyId}`);
  return toViewModelPage(res, { page, size });
}

export async function createPropertyReview(propertyId, review) {
  const created = await post(
    `/reviews/property/${encodeURIComponent(propertyId)}`,
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
 * Say so when the corpus is larger than the page every aggregate is computed over.
 *
 * Silence here would mean an average quietly drifting from the truth as a listing gets popular —
 * the failure mode that gets *more* likely the more the platform succeeds, and the one nobody
 * reproduces because it needs a hundred reviews to appear.
 */
function warnIfTruncated(res, what) {
  const returned = Array.isArray(res?.content) ? res.content.length : 0;
  const total = res?.totalElements ?? returned;
  if (total > returned) {
    console.warn(
      `[reviews] ${what} has ${total} reviews but only ${returned} were fetched. The average, the ` +
        'star distribution and the category means are computed over what is loaded, so they are ' +
        'now approximations. Paging is needed here.',
    );
  }
}
