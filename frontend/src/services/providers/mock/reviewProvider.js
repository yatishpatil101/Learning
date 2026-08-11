/**
 * Mock review provider — the localStorage counterpart to `providers/http/reviewProvider.js`.
 *
 * Two stores, because the app grew two and the seam's job is to hide that, not to migrate it:
 *
 *   - property reviews → `puneNestPropReviews`, keyed by property id (`pages/consumer/property/reviews.js`)
 *   - entity reviews   → `pnEntityReviews`, keyed `"<type>:<id>"` (`lib/store/reviews.js`)
 *
 * Both are read through here so the pages see one vocabulary. The http provider sees one server
 * table behind two routes, which is the mirror image — and the reason the service exposes four
 * operations rather than a single `listReviews(type, id)`.
 *
 * ## The mock is the permissive one, deliberately
 *
 * It has no eligibility gate (anyone may rate anything), no moderation status (everything written
 * is immediately visible) and it will store a `context` badge the caller supplies. All three are
 * asymmetries in the safe direction: a flow that works against the API also works here. The
 * opposite would be a demo that passes and a production that 403s.
 *
 * The one thing this deliberately does *not* copy is the old write path's `context: 'visit'`
 * literal. See `createPropertyReview`.
 */
import { readUser } from '../../../lib/auth.js';
import {
  getEntityReviews as _getEntity,
  addEntityReview as _addEntity,
} from '../../../lib/store/reviews.js';
import { loadReviews as _loadProp, saveReview as _saveProp } from '../../../pages/consumer/property/reviews.js';

/** `YYYY-MM-DD`, which is what the card renders raw and what the old write path stored. */
const today = () => new Date().toISOString().slice(0, 10);

/** Unpaged stores answer the paged contract by reporting the whole list as one page. */
const page = (items) => ({ items, total: items.length, page: 0, size: items.length });

/**
 * The aspects a sub-rating may be given for — **one vocabulary per target type**, as on the server.
 *
 * Repeated here rather than imported from `ReviewsSection.jsx` / `society/constants.js`, which is
 * where the pages' copies live: a provider that imports a page component drags React into the
 * service layer and makes the seam depend on the surface it exists to hide. The server validates
 * against the same per-type sets, so a key from the wrong vocabulary is a 400 live — filtering to
 * them here is what stops a hand-edited localStorage entry producing a category row the API would
 * never send.
 *
 * `locality` and `owner` use the property vocabulary, matching `ReviewCategories.forTarget`.
 */
const PROPERTY_CATEGORY_KEYS = ['locality', 'condition', 'value', 'owner', 'accuracy'];
const SOCIETY_CATEGORY_KEYS = ['Safety', 'Maintenance', 'Management', 'Amenities', 'Connectivity'];
const categoryKeysFor = (entityType) => (entityType === 'society' ? SOCIETY_CATEGORY_KEYS : PROPERTY_CATEGORY_KEYS);

/**
 * One decimal.
 *
 * `toFixed`, not `Math.round(n * 10) / 10`: the server rounds a `BigDecimal` HALF_UP via its
 * decimal string, and the multiply-round form disagrees with that at binary-float ties — 81/20 is
 * 4.05, whose `* 10` is 40.499999999999993, so it rounds down to 4.0 where the server says 4.1.
 * A parity harness that compares the two providers' output is exactly what finds that.
 */
const round1 = (n) => Number(n.toFixed(1));

export async function listPropertyReviews(propertyId) {
  return page(_loadProp(propertyId));
}

/**
 * The rating summary for one listing (D79) — the same numbers `GET .../reviews/summary` computes,
 * from the same rows this store's `listPropertyReviews` would return.
 *
 * Derived rather than stored, because a stored aggregate is a second copy of the truth that drifts
 * the first time somebody writes a review through a path that forgets to update it. The three
 * places this has to match the server exactly, and each is a way the mock could quietly be kinder
 * than production:
 *
 *   - **`avg` is null, not 0, at zero reviews.** The page's markup only reads it past a `count > 0`
 *     gate, so a 0 here would never render — it would just remove the reason the gate exists, and
 *     the day something drops the gate the mock would keep looking fine while live showed 0.0.
 *   - **Rounded to one decimal.** The old client-side reduce rounded at render (`.toFixed(1)`); the
 *     server rounds before serialising. Same picture at one decimal, different numbers to anyone
 *     comparing the two providers' output, which is what the parity harness does.
 *   - **`catAvg` is sparse and per-aspect.** An aspect is averaged over the reviews that answered
 *     *it*, not over every review. Using the review count as the denominator understates every
 *     aspect and is the kind of wrong that still looks like a plausible rating.
 */
export async function getPropertyReviewSummary(propertyId) {
  return summarise(_loadProp(propertyId), PROPERTY_CATEGORY_KEYS);
}

/**
 * Stored rows → the `{ count, avg, dist, catAvg }` both summary operations answer with.
 *
 * One function for the property route and the three entity routes because the server computes them
 * with one pair of queries parameterised by target — a second copy here would drift from the first
 * the moment either endpoint's rounding or sparseness changed, and drift between two mocks is drift
 * nobody is watching for. The vocabulary is a parameter for the same reason it is one on the
 * server: it is the only thing that differs between a society's aggregate and a listing's.
 */
function summarise(rows, keys) {
  const count = rows.length;
  const dist = [0, 0, 0, 0, 0];
  rows.forEach((r) => {
    const k = Math.round(+r.rating || 0) - 1;
    if (k >= 0 && k < 5) dist[k] += 1;
  });
  const catAvg = {};
  keys.forEach((k) => {
    // `>= 1 && <= 5`, not `> 0`: the server's aggregate filters the JSONB entries to that range
    // (its own comment names `{"locality": 99}` as the case), so a hand-edited localStorage entry
    // must not produce a 99.0 row here that the API would never send.
    const answered = rows.map((r) => Number(r.categories?.[k])).filter((v) => Number.isFinite(v) && v >= 1 && v <= 5);
    if (answered.length) catAvg[k] = round1(answered.reduce((a, v) => a + v, 0) / answered.length);
  });
  const avg = count ? round1(rows.reduce((a, r) => a + (+r.rating || 0), 0) / count) : null;
  return { count, avg, dist, catAvg };
}

export async function createPropertyReview(propertyId, review) {
  const u = readUser();
  if (!u) return 'login';
  const saved = {
    id: 'RV' + Date.now(),
    user: u.name || 'PuneNest User',
    rating: review?.rating || 0,
    text: review?.text || '',
    categories: review?.categories || {},
    recommend: review?.recommend ?? null,
    /**
     * Left unset on purpose.
     *
     * The modal used to submit `context: 'visit'` as a literal on every review, and the store kept
     * it, so the "Visited" badge was a claim the browser made about itself. The server derives this
     * from visit and tenancy history and refuses the field on write. Fabricating it here would mean
     * the badge is trustworthy live and meaningless on mocks — and mocks are what the screenshots
     * and the demo are taken from.
     */
    at: today(),
  };
  _saveProp(propertyId, saved);
  return saved;
}

export async function listEntityReviews(entityType, entityId) {
  // The stored `at` is an epoch from `addEntityReview`; the card wants the same display date the
  // property store holds, so normalise here rather than teaching two pages two formats.
  const items = _getEntity(entityType, entityId).map((r) => ({
    id: r.id,
    user: r.user || 'User',
    rating: +r.rating || 0,
    text: r.text || '',
    categories: r.categories || {},
    recommend: r.recommend ?? null,
    context: r.context ?? null,
    at: typeof r.at === 'number' ? new Date(r.at).toISOString().slice(0, 10) : (r.at || ''),
  }));
  return page(items);
}

export async function createEntityReview(entityType, entityId, review) {
  // `categories` is passed through rather than dropped: the society hub collects per-aspect stars
  // and the hub's own bars read them straight back out of this store. Filtered to the target's
  // vocabulary so the mock cannot accept a key the server would 400, which is the asymmetry that
  // would let a demo look right and production reject the same write.
  const allowed = categoryKeysFor(entityType);
  const categories = {};
  allowed.forEach((k) => {
    const v = Number(review?.categories?.[k]);
    if (Number.isFinite(v) && v >= 1 && v <= 5) categories[k] = v;
  });
  const saved = _addEntity(entityType, entityId, {
    rating: review?.rating || 0,
    text: review?.text || '',
    categories,
  });
  // `addEntityReview` returns the string 'login' when nobody is signed in. Passed through rather
  // than thrown so both providers fail the same way and the caller keeps one branch.
  if (saved === 'login') return 'login';
  return {
    id: saved.id,
    user: saved.user,
    rating: +saved.rating || 0,
    text: saved.text || '',
    categories: saved.categories || {},
    recommend: null,
    context: null,
    at: new Date(saved.at).toISOString().slice(0, 10),
  };
}

/**
 * The rating summary for a society, locality or owner (D79, entity half).
 *
 * The same aggregate as `getPropertyReviewSummary` over the other store, and the same three things
 * it must not soften: `avg` is null rather than 0 at zero reviews, everything is rounded to one
 * decimal, and `catAvg` is sparse with a per-aspect denominator.
 *
 * The vocabulary is the target's, not the property one: a society is averaged over Safety,
 * Maintenance, Management, Amenities and Connectivity, which is what the hub's bars are keyed on
 * and what the server now aggregates. `locality` and `owner` keep the property aspects.
 *
 * ## The one asymmetry, stated rather than hidden
 *
 * The server resolves `(entityType, entityId)` against real rows and **404s a target it does not
 * recognise**; this store has no registry to check against, so an unknown id yields a plausible
 * zero-review summary. That is the mock being more generous than production: a typo'd slug reads as
 * "no reviews yet" here and as "rating unavailable" live. It is the same asymmetry
 * `listEntityReviews` already has, and closing it would mean teaching the service layer the society
 * catalogue, the locality list and the mock user table — three page-level data modules the seam
 * exists to stay out of. What callers must not do is invert it: a *rejection* means "we do not know",
 * never "there are none".
 */
export async function getEntityReviewSummary(entityType, entityId) {
  return summarise(_getEntity(entityType, entityId), categoryKeysFor(entityType));
}
