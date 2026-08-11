/**
 * Mock society provider — the localStorage counterpart to `providers/http/societyProvider.js`.
 *
 * The rating aggregate is derived from `pnEntityReviews` (`lib/store/reviews.js`), the same bucket
 * the society hub's composer writes through the review seam. Derived rather than stored, for the
 * reason the mock review provider gives at length: a stored aggregate is a second copy of the
 * truth that drifts the first time something writes a review without updating it.
 *
 * Two details exist purely to keep the mock from being kinder than the server:
 *
 *   - **`avg` is null at zero reviews**, not 0. The card only reads it past a `count > 0` gate, so
 *     a 0 would never render — it would just remove the reason the gate exists, and the day
 *     something drops the gate the mock would keep looking fine while live rendered a one-star
 *     society. This is also where the old `entityRating` differed: it returned `{ avg: 0 }`.
 *   - **`toFixed(1)`, not `Math.round(n * 10) / 10`.** The server rounds a `BigDecimal` HALF_UP via
 *     its decimal string and the multiply-round form disagrees with that at binary-float ties: 81/20
 *     is 4.05, whose `* 10` is 40.499999999999993, so it rounds down to 4.0 where the server says
 *     4.1. `entityRating` used the multiply-round form.
 *
 * Only societies with at least one review appear in the index — absent, not zero — because that is
 * what the http provider cannot help doing (the server omits unrated societies from the grouped
 * aggregate) and the seam's job is to make the two indistinguishable to the caller.
 */
import { allEntityReviews } from '../../../lib/store/reviews.js';

/** One decimal, rounded the way the server's `BigDecimal.setScale(1, HALF_UP)` rounds. */
const round1 = (n) => Number(n.toFixed(1));

const PREFIX = 'society:';

export async function listSocietyRatings() {
  const index = {};
  for (const [key, reviews] of Object.entries(allEntityReviews())) {
    if (!key.startsWith(PREFIX) || !Array.isArray(reviews) || !reviews.length) continue;
    const sum = reviews.reduce((a, r) => a + (Number(r?.rating) || 0), 0);
    index[key.slice(PREFIX.length)] = {
      avg: round1(sum / reviews.length),
      count: reviews.length,
    };
  }
  return index;
}
