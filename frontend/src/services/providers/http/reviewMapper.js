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
