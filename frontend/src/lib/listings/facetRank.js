/* ---------- listings result ordering ----------
   The ordering half of the search contract, kept beside the matcher so mock mode and live mode
   answer "what comes first" the same way. Mirrors `PropertySpecs.relevanceFirst` /
   `boostedFirst` weight for weight; the weights themselves are a product judgement about what a
   buyer should be shown first, and they belong in one place rather than two. */
import { createdMs, freshnessState } from '../freshness.js';
import { computeQualityScore } from '../qualityScore.js';
import { isFeaturedActive } from '../featured.js';

/**
 * Paid placement (D59): 1 while the promotion window is open, 0 otherwise.
 *
 * Reads the derived `boosted` flag the read boundary attaches (the wire's own field in http mode,
 * `isBoostedNow` in mock mode) rather than re-deriving it from `boostedUntil`, so there is one
 * definition of "promoted right now" per mode and the order cannot drift from the badge.
 */
const boostRank = (p) => (p.boosted ? 1 : 0);

const FRESH_WEIGHT = { active: 200, aging: 120, stale: 40, dormant: 0 };

/* Promote what a buyer should trust and act on first: featured slots, verified owners/ownership and
   RERA, actively-managed listings, and more complete ones. */
const relevanceScore = (p) => {
  let s = 0;
  if (isFeaturedActive(p)) s += 1000;
  if (p.ownerVerified) s += 250;
  if (p.ownershipVerified) s += 200;
  if (p.rera) s += 80;
  s += FRESH_WEIGHT[freshnessState(p)] || 0;
  s += computeQualityScore(p);
  return s;
};

/**
 * Order a result set the way the query asks for, returning a new array.
 *
 * Paid placement applies to the two default-ish orders only — `newest` and the `relevance`
 * fallback — and never to an explicit price sort. Ranking a promoted listing above one the buyer
 * asked to see first is deception rather than advertising; the server draws the line in the same
 * place (`PropertySort.hasExplicitSort`).
 *
 * @param {object[]} list listings to order.
 * @param {object} q query object from {@link toFacetQuery} — reads `sort` and `rank`.
 */
export function sortByQuery(list, q = {}) {
  const out = list.slice();
  if (q.sort === 'price,asc') out.sort((a, b) => a.price - b.price);
  else if (q.sort === 'price,desc') out.sort((a, b) => b.price - a.price);
  else if (q.rank === 'newest') {
    out.sort((a, b) => boostRank(b) - boostRank(a) || createdMs(b.createdAt) - createdMs(a.createdAt));
  } else {
    out.sort((a, b) => boostRank(b) - boostRank(a)
      || relevanceScore(b) - relevanceScore(a)
      || createdMs(b.createdAt) - createdMs(a.createdAt));
  }
  return out;
}
