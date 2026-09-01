/**
 * Society Service — the review aggregate a society card renders, and the caller's follows.
 *
 * ## Why this domain exists at all, and why it is one operation wide
 *
 * The society *catalogue* is not behind the seam: `data/societies.js` is still the source of the
 * 348 rows the directory lists, and moving it is a much larger change than this one. What was
 * behind nothing at all was the **rating** on those rows. The directory used
 * `entityRating('society', slug)`, a reduce over the `pnEntityReviews` localStorage bucket, which
 * is dead against a live server: the reviews are in Postgres, nothing writes that bucket in live
 * mode, and so every card in the grid renders "Not rated yet" for a society that may have fifty
 * reviews. It does not error and it does not look broken — it looks like a quiet building.
 *
 * The fix is not to route the cards through `reviewService.getEntityReviewSummary`. That is one
 * request per card, 348 of them on the directory, to draw one number each. `GET /societies`
 * already carries `avgRating` and `reviewCount` per row — the server computes them in a single
 * grouped query per page (`RatingLookup.forSocieties`) for exactly this call site — so the whole
 * grid's ratings cost one paged read of a list endpoint that already exists.
 *
 * Hence the shape: **one operation, returning an index keyed by slug**, not a `getSociety(slug)`.
 * A per-society signature would put the caller back in a `.map()` issuing a request per row, which
 * is the thing this exists to avoid.
 *
 * ## Slug, not id
 *
 * The key is `soc.slug`. `soc.id` is a synthetic `S01` minted by `data/societies.js` that the
 * server has never seen; the server keys societies by UUID and accepts the slug as the public
 * alias. Every other society surface already joins on the slug.
 *
 * ## `avg` is null, not 0
 *
 * An unrated society has `{ avg: null, count: 0 }`, matching `GET /societies`, which sends
 * `avgRating: null` rather than `0` — and matching `getPropertyReviewSummary` / `getEntityReviewSummary`,
 * which make the same distinction for the same reason. No rating is not a rating of zero, and a 0
 * here would render as a one-star society. Callers must branch on `count`, never on the average
 * being falsy.
 *
 * A slug absent from the index is *not* the same as an unrated society: it means this reader has
 * no opinion about it (the server does not have that society, or the read has not resolved). The
 * caller decides what to say about that, and "nothing" is usually the honest answer.
 *
 * ## Follows (D227)
 *
 * The second thing on this domain is the follow set. It was `pnFollowedSocieties`, a localStorage
 * array, which meant following a society on a laptop did not follow it on a phone — and the
 * follower count on the hub, which the server computes from the join table, counted nobody at all
 * because nothing ever wrote a row.
 *
 * **Slugs, not rows.** `GET /me/societies/following` returns full society cards, which is the right
 * contract — a follow list is a list of societies and an endpoint that answered with bare strings
 * would be useless to any other client. This seam narrows it to slugs because that is the whole of
 * what the five follow surfaces ask for: four of them only need membership, and the one that
 * renders cards (`FollowedSocietiesPanel`) already resolves each slug through the local society
 * catalogue to get the synthetic `S01` id that `listingsInSociety` joins on. Handing it server rows
 * would replace that id with a UUID and it would silently match no listings.
 *
 * **These are not for components to call directly.** Membership is asked once per card on the
 * directory, so per-call reads are the N+1 this seam exists to prevent; `context/FollowContext.jsx`
 * holds the set and answers `has(slug)` from memory. Only that context should import these.
 */
import { createProvider } from './config.js';

const provider = createProvider('society');

/**
 * Every society's rating aggregate in one read, indexed by slug.
 *
 * @returns {Promise<Record<string, {avg: number|null, count: number}>>} `avg` is rounded to one
 *   decimal and is `null` when `count` is 0. Slugs the source knows nothing about are absent
 *   rather than present-and-zero.
 */
export const listSocietyRatings = async () => (await provider()).listSocietyRatings();

/**
 * The slugs of the societies the caller follows, most recently followed first.
 *
 * @returns {Promise<string[]>} newest first. Empty when signed out — the route is caller-scoped.
 */
export const listFollowedSocieties = async () => (await provider()).listFollowedSocieties();

/**
 * Follow one society. Idempotent: following one already followed is not an error.
 *
 * @param {string} slug the society's public key
 * @throws {ApiError} 404 when no society has this slug — which is the case for a society minted
 *   only in this browser, and the reason `FollowContext` keeps those follows local.
 */
export const followSociety = async (slug) => (await provider()).followSociety(slug);

/** Unfollow one society. Idempotent: unfollowing one not followed is not an error. */
export const unfollowSociety = async (slug) => (await provider()).unfollowSociety(slug);
