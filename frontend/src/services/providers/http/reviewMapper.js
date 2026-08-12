/**
 * `Review` (wire) → the review view model the pages render.
 *
 * The two vocabularies are close but not identical, and the differences are all in the same
 * direction: the wire names the thing precisely, the UI named it whatever the first component
 * needed.
 *
 *   author    → user   the display name. Not an id: a review is a public document and the reader
 *                      needs a human to attribute it to, so nothing else about the author is on the
 *                      wire — in particular no mobile, which is why this never touches the gate.
 *   body      → text
 *   createdAt → at     ISO instant → `YYYY-MM-DD`. The card renders `{r.at}` raw, and that is the
 *                      shape the mock store already held. Formatting here rather than in the card
 *                      keeps the two providers' output identical, which is the property the parity
 *                      harness checks.
 *
 * `rating`, `categories`, `recommend` and `context` are already the same word on both sides — the
 * property page was written against this contract even while it was reading localStorage.
 *
 * ## `context` is passed through untouched, and may be null
 *
 * It is the server-derived "Verified resident" (`tenant`) / "Visited" (`visit`) badge, and the
 * page's filter chips already use exactly those two tokens, so there is nothing to translate.
 *
 * It is **null** on society, locality and owner reviews — there is no visit or tenancy to evidence
 * for a locality — and it can be null on a property review too. Null is normalised to null rather
 * than to a default, because the one thing that must not happen is a missing badge rendering as a
 * present one.
 */

/** ISO instant → the `YYYY-MM-DD` the card prints. Empty string for a missing date. */
function displayDate(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

/**
 * The product's order for the per-aspect rows, which is *not* the order either provider emits.
 * See `toSummaryViewModel`. Anything outside the target's set is dropped: it matches the server's
 * closed key vocabulary, so a key the API would reject cannot reach the page from any other source.
 *
 * **Two vocabularies, and picking the wrong one renders an empty grid rather than an error.** A
 * society is rated on Safety/Maintenance/Management/Amenities/Connectivity; a listing, a locality
 * and an owner on locality/condition/value/owner/accuracy. This mirrors `ReviewCategories.forTarget`
 * on the server and `categoryKeysFor` in the mock provider — three copies of one list, because the
 * alternative is the client importing a server enum or the seam learning the review domain. They
 * are keys, not labels: renaming one orphans every rating already stored under the old id.
 */
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

/**
 * A bare `Review[]` → the same `{ items, total, page, size }` the paged route yields.
 *
 * `GET /properties/{propId}/reviews` is unpaged by ruling D8.6 and answers with an array, not an
 * envelope. Reporting it as one whole page keeps `reviewService`'s single documented return shape
 * true for both routes, so no caller has to know which of the two it asked.
 */
export function toViewModelListPage(rows) {
  const items = (Array.isArray(rows) ? rows : []).map(toViewModel).filter(Boolean);
  return { items, total: items.length, page: 0, size: items.length };
}

/** A `PageResponse<Review>` → the `{ items, total, page, size }` both providers return. */
export function toViewModelPage(res, fallback = {}) {
  const rows = Array.isArray(res?.content) ? res.content : [];
  return {
    items: rows.map(toViewModel).filter(Boolean),
    total: res?.totalElements ?? rows.length,
    page: res?.page ?? res?.number ?? fallback.page ?? 0,
    size: res?.size ?? fallback.size ?? rows.length,
  };
}

/**
 * `ReviewSummary` (wire) → the aggregate the property page's rating block renders (D79).
 *
 * The page computed all four of these in the browser by reducing the whole review array, which is
 * why `listReviews` was not allowed to be paged: three visible numbers were correct only for as
 * long as the array stayed whole. They now come from SQL, and the shape below is deliberately the
 * one the page already had — `count`, `avg`, `dist`, `catAvg` — so the swap is a data-source change
 * rather than a rewrite of the markup that reads it.
 *
 * Two renames worth stating, because both have a wrong answer that renders without complaining:
 *
 *   distribution → dist   `{"1":n … "5":n}`, string keys, becomes a 0-based five-slot array,
 *                         because the bars are drawn `[5,4,3,2,1].map(s => dist[s - 1])`. All five
 *                         keys are always present on the wire, but they are defaulted anyway: an
 *                         absent bar and a zero-height bar are different pictures and only one is
 *                         true, and a contract note is not an enforcement.
 *   avgRating    → avg    passed through **null**, never coerced to 0. A star strip showing 0.0
 *                         states something false about a listing nobody has reviewed yet, and
 *                         `|| 0` here is exactly how that gets shipped. The page reads it only
 *                         inside its `count > 0` branch, which is what makes null safe.
 *
 * `categoryAverages` is sparse by contract — an aspect nobody rated is absent rather than 0,
 * because averaging it over everyone would understate it — so it is copied key by key rather than
 * expanded to a fixed set.
 *
 * `entityType` selects which vocabulary those keys are drawn from and defaults to the property one,
 * which is what every caller but the society hub wants. Passing nothing for a society is not a
 * degraded rendering but an empty one: none of the five society keys survives the property
 * allowlist, so `catAvg` comes back `{}` and the aspect grid draws nothing at all, on every society,
 * for ever. That was live behaviour until D197 — invisible only because the hub was blending in a
 * fabricated baseline, so the bars looked populated whether or not a single key had survived.
 *
 * There is no `recommend` field here and that is not an omission: "% would recommend" has no server
 * aggregate, and the page still derives it from the list. See `ReviewsSection.jsx`.
 */
export function toSummaryViewModel(s, entityType) {
  const dist = ['1', '2', '3', '4', '5'].map((star) => Number(s?.distribution?.[star]) || 0);
  const catAvg = {};
  /* Iterate a fixed order rather than the wire's. The page renders these rows with
     `Object.keys(catAvg).map`, so insertion order *is* row order — and the two providers do not
     agree on it: the server's aggregate ends `order by c.key`, which is alphabetical (Accuracy,
     Condition, Locality, Owner, Value), while the mock inserts in the product's order. That made
     the e2e suite and every screenshot prove a layout production does not render. Ordering here,
     rather than at either edge, makes the row order provider-independent; only present keys are
     copied, so the sparseness the server is careful about survives. */
  categoryOrderFor(entityType).forEach((k) => {
    const n = Number(s?.categoryAverages?.[k]);
    // Guarded because these are BigDecimals on the server: JSON gives us a number, but a
    // serialiser configured to write decimals as strings would otherwise reach `.toFixed` as NaN.
    if (Number.isFinite(n)) catAvg[k] = n;
  });
  const avg = s?.avgRating == null ? null : Number(s.avgRating);
  /* `count` and `avg` are read off the payload independently, so the server's invariant that they
     move together is not enforced by anything on this side. The page draws stars inside a
     `count > 0` branch and dereferences `avg` there twice; a response carrying a count with no
     usable average — a serialiser change, a proxy stripping a field — would render `NaN` or throw
     mid-render and take the section down. Collapsing to "no reviews" is the honest reading: we
     have no average to show. */
  const rawCount = Number(s?.reviewCount) || 0;
  const count = rawCount > 0 && !Number.isFinite(avg) ? 0 : rawCount;
  return { count, avg: count === 0 ? null : avg, dist, catAvg };
}

/**
 * The page's review object → `ReviewCreate`.
 *
 * Note what is *not* here: `context`, `targetType` and `targetId`. The badge is derived server-side
 * and the contract marks it `readOnly`; the target comes from the path. A body that could name its
 * own target would let a caller review property B through property A's endpoint and skip the
 * eligibility check the path drives.
 *
 * `categories` keys are validated server-side against a closed set, so an unknown key is a 400
 * rather than a silently dropped field — sending the map as-is is safe and the error is legible.
 */
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
