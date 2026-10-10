/** `context` stays null when absent so a missing badge never renders as a present one;
 * `at` is formatted to `YYYY-MM-DD` here because the card renders it raw. */

/** ISO instant → the `YYYY-MM-DD` the card prints. Empty string for a missing date. */
function displayDate(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

/** Product row order, not the server's. Keys mirror `ReviewCategories.forTarget`; the wrong vocabulary renders
 * an empty grid, and they are ids since renaming one orphans stored ratings. */
const PROPERTY_CATEGORY_ORDER = ['locality', 'condition', 'value', 'owner', 'accuracy'];
const SOCIETY_CATEGORY_ORDER = ['Safety', 'Maintenance', 'Management', 'Amenities', 'Connectivity'];
const categoryOrderFor = (entityType) =>
  (entityType === 'society' ? SOCIETY_CATEGORY_ORDER : PROPERTY_CATEGORY_ORDER);

/** One wire `Review` → one view model. */
export function toViewModel(r) {
  if (!r) return null;
  return {
    id: r.id,
    user: r.author || 'User',
    rating: Number(r.rating) || 0,
    text: r.body || '',
    // `categories` is documented as empty-rather-than-null so the client can iterate without a
    // guard; defaulted anyway, because a contract note is not an enforcement.
    categories: r.categories || {},
    // Tri-state: true / false / null. `?? null` and not `|| null`, or a genuine "would not
    // recommend" would be silently reported as "did not say".
    recommend: r.recommend ?? null,
    context: r.context ?? null,
    at: displayDate(r.createdAt),
  };
}

/** A `PageResponse<Review>` (or the property list, which is one whole page) → `{ items, total, page, size }`. */
export function toViewModelPage(res, fallback = {}) {
  const rows = Array.isArray(res?.content) ? res.content : [];
  return {
    items: rows.map(toViewModel).filter(Boolean),
    total: res?.totalElements ?? rows.length,
    page: res?.page ?? res?.number ?? fallback.page ?? 0,
    size: res?.size ?? fallback.size ?? rows.length,
  };
}

/** Aggregates come from SQL so `listReviews` can be paged. `avg` stays null (0.0 stars lies for unreviewed);
 * `entityType` picks the key vocabulary, or a society's `catAvg` comes back empty. */
export function toSummaryViewModel(s, entityType) {
  const dist = ['1', '2', '3', '4', '5'].map((star) => Number(s?.distribution?.[star]) || 0);
  const catAvg = {};
  /* Fixed order: the page renders Object.keys(catAvg), and the server's alphabetical order isn't the product's;
     only present keys are copied so sparseness survives. */
  categoryOrderFor(entityType).forEach((k) => {
    const n = Number(s?.categoryAverages?.[k]);
    // Guarded because these are BigDecimals on the server: JSON gives us a number, but a
    // serialiser configured to write decimals as strings would otherwise reach `.toFixed` as NaN.
    if (Number.isFinite(n)) catAvg[k] = n;
  });
  const avg = s?.avgRating == null ? null : Number(s.avgRating);
  /* count and avg aren't enforced together here; a count without a usable avg would render NaN or throw
     mid-render, so collapse to "no reviews". */
  const rawCount = Number(s?.reviewCount) || 0;
  const count = rawCount > 0 && !Number.isFinite(avg) ? 0 : rawCount;
  return { count, avg: count === 0 ? null : avg, dist, catAvg };
}

/** Separate from toViewModel because `status` varies only in the moderation queue; `target` is composed
 * ("Locality: Wakad") so a moderator sees what is reviewed, and UUIDs stay untruncated. */
export function toModerationViewModel(r) {
  const base = toViewModel(r);
  if (!base) return null;
  const type = r.targetType ? String(r.targetType) : '';
  const label = type ? type.charAt(0).toUpperCase() + type.slice(1) : '';
  return {
    ...base,
    // `pending` is the intake state; defaulted so the Badge never renders an empty chip that reads as "approved".
    status: r.status || 'pending',
    target: label && r.targetId ? `${label}: ${r.targetId}` : label || null,
  };
}

/** A `PageResponse<Review>` from the moderation queue → `{ items, total, page, size }`. */
export function toModerationViewModelPage(res, fallback = {}) {
  const rows = Array.isArray(res?.content) ? res.content : [];
  return {
    items: rows.map(toModerationViewModel).filter(Boolean),
    total: res?.totalElements ?? rows.length,
    page: res?.page ?? res?.number ?? fallback.page ?? 0,
    size: res?.size ?? fallback.size ?? rows.length,
    counts: res?.counts || null,
  };
}

/** `context`, `targetType` and `targetId` are omitted: the badge is server-derived and the target comes from
 * the path, so a body can't review property B through property A's endpoint. */
export function toReviewCreate(review) {
  const out = { rating: Number(review?.rating) || 0 };
  const text = String(review?.text || '').trim();
  if (text) out.body = text;
  if (review?.categories && Object.keys(review.categories).length) out.categories = review.categories;
  // Only send it when the author actually answered — omitting is how "did not say" is expressed,
  // and `false` is a different, real answer.
  if (review?.recommend != null) out.recommend = review.recommend;
  return out;
}
