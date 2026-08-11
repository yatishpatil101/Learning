/**
 * Wire → view-model translation for the society domain.
 *
 * One function, because the domain is one operation wide (see `services/societyService.js`).
 */

/**
 * Index a page of `Society` rows by slug, keeping only the rating aggregate.
 *
 * `avgRating` is passed through as **null**, never coerced to a number: the contract sends
 * `"avgRating": null` for a society with no published reviews, and `Number(null)` is 0 — the one
 * transformation that turns "nobody has rated this" into "everybody rated it one star". Same
 * reasoning as `reviewMapper.js` on the summary's `avg`.
 *
 * Rows without a slug are skipped rather than indexed under `undefined`; the slug is the only key
 * the frontend's society catalogue can join on.
 *
 * @param {object[]} rows `content` from `GET /societies`
 * @returns {Record<string, {avg: number|null, count: number}>}
 */
export function toRatingIndex(rows) {
  const index = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.slug) continue;
    index[row.slug] = {
      avg: row.avgRating == null ? null : Number(row.avgRating),
      count: Number(row.reviewCount) || 0,
    };
  }
  return index;
}
