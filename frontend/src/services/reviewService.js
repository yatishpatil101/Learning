/**
 * Review Service — ratings written by users about a property, a society, a locality or an owner.
 *
 * ## One table, two routes, and why the split is in the contract
 *
 * The server serves reviews from two endpoints, not one:
 *
 *   GET|POST /properties/{propId}/reviews        → `listPropertyReviews` / `createPropertyReview`
 *   GET      /properties/{propId}/reviews/summary → `getPropertyReviewSummary`
 *   GET|POST /reviews/{entityType}/{entityId}    → `listEntityReviews`   / `createEntityReview`
 *   GET      /reviews/{entityType}/{entityId}/summary → `getEntityReviewSummary`
 *                                                  entityType ∈ society | locality | owner
 *
 * They share a table but not a rule, which is why this module mirrors the split rather than
 * flattening it behind one `listReviews(type, id)`. Only a *property* review carries the
 * `context` badge, only a property review has an eligibility gate, and only the entity list is
 * paged. A single signature would have to document all of that as "depends on the first argument",
 * which is how a caller ends up passing `'property'` to the entity route and quietly getting a
 * different set of guarantees than they think.
 *
 * ## `context` is the server's word, never the client's
 *
 * `context` is the "Verified resident" / "Visited" badge. It is **derived from the author's visit
 * and tenancy history** and is `readOnly` in the contract — `ReviewCreateRequest` has no such field.
 *
 * That matters because the badge is the only reason a stranger's opinion is worth reading. The mock
 * write path used to send `context: 'visit'` as a literal on every submission, and the mock stored
 * what it was told, so a review's standing was whatever the browser claimed. Against the API that
 * field is ignored and the server answers the question from data the user cannot edit. The write
 * shape here therefore has no `context` — not "it is optional", but "it is not yours to send".
 *
 * The same reasoning applies to the society hub's `resident` flag, which was computed client-side
 * from `isVerifiedResident(slug)` and stored alongside the review.
 *
 * ## Shape
 *
 * Both list operations return `{ items, total, page, size }`. `items` are view models in the
 * property page's existing vocabulary, so the pages did not have to be rewritten around the wire
 * names:
 *
 *   { id, user, rating, text, at, categories, recommend, context }
 *
 * `at` is a display date (`YYYY-MM-DD`), which is what the mock stored and what the card renders
 * raw. `categories` is always an object and `recommend` is `null` when the author did not answer —
 * distinct from `false`, and the summary counts it as "did not say" rather than "would not".
 *
 * ## What is not live yet, and why
 *
 * An entity review is only as live as the entity it points at, because the target id has to be one
 * the server recognises:
 *
 *   - `locality` — the frontend and the database agree on the slug (`baner`). Live.
 *   - `society`  — they agree on the *slug* (`green-meadows-baner`) but not the id: the mock's
 *                  `soc.id` is a synthetic `S01`. Callers must key on `soc.slug`, which is what the
 *                  rest of the hub already does; reviews were the one place still keyed on `id`.
 *   - `owner`    — no agreement at all. `getOwner()` still reads `lib/mockApi/users.js`, whose ids
 *                  are mock user ids, and the server keys on its own user UUIDs. `Owner.jsx`
 *                  therefore still reads its review *cards* from the mock store; only the rating
 *                  aggregate goes through `getEntityReviewSummary`, and it is safe there precisely
 *                  because an id the server does not recognise 404s and the page renders "rating
 *                  unavailable" rather than a confident "no reviews yet". The list moves when the
 *                  owner profile does.
 */
import { createProvider } from './config.js';

const provider = createProvider('review');

/**
 * Reviews of one property, newest first.
 *
 * @param {string} propertyId
 * @param {{page?: number, size?: number}} [opts]
 * @returns {Promise<{items: object[], total: number, page: number, size: number}>}
 */
export const listPropertyReviews = async (propertyId, opts) =>
  (await provider()).listPropertyReviews(propertyId, opts);

/**
 * The rating aggregate for one listing: `{ count, avg, dist, catAvg }`.
 *
 * A separate read from `listPropertyReviews`, not a field on it, and that separation is the whole
 * point (D79). The property page used to reduce the full review array to get these four values,
 * which made "never page that endpoint" a correctness constraint rather than a preference — page it
 * and the stars would go on rendering, now silently describing page one. It also meant downloading
 * every review of a listing to draw one number.
 *
 * `avg` is **null**, not 0, on an unreviewed listing: no rating is not a rating of zero. `dist` is a
 * 0-based five-slot array (`dist[0]` is the one-star count) and is always five entries long.
 * `catAvg` is sparse — an aspect nobody rated is absent.
 *
 * There is no "% would recommend" here. It has no server aggregate, so the page still derives it
 * from the list it is already showing.
 *
 * @param {string} propertyId the listing's **UUID** — the route binds a UUID, and the seam's `p.id`
 *                            is the slug. Callers pass `p.uuid || p.id`.
 * @returns {Promise<{count: number, avg: number|null, dist: number[], catAvg: object}>}
 */
export const getPropertyReviewSummary = async (propertyId) =>
  (await provider()).getPropertyReviewSummary(propertyId);

/**
 * Rate a property.
 *
 * Eligibility (a completed visit or a tenancy) is enforced server-side; the page checks it too so
 * the button can explain itself, but the check that counts is the one the caller cannot skip.
 *
 * @param {string} propertyId
 * @param {{rating: number, text?: string, categories?: object, recommend?: boolean|null}} review
 */
export const createPropertyReview = async (propertyId, review) =>
  (await provider()).createPropertyReview(propertyId, review);

/**
 * Reviews of a society, locality or owner.
 *
 * @param {'society'|'locality'|'owner'} entityType
 * @param {string} entityId slug for society and locality; see the module note on owner
 */
export const listEntityReviews = async (entityType, entityId, opts) =>
  (await provider()).listEntityReviews(entityType, entityId, opts);

/**
 * The rating aggregate for one society, locality or owner: `{ count, avg, dist, catAvg }`.
 *
 * The same shape `getPropertyReviewSummary` returns, and the urgent half of D79 rather than the
 * insurance half. `listEntityReviews` has been **paged at 20 since S27**, so the society hub, the
 * owner profile and the locality reviews block were not averaging their reviews — they were
 * averaging page one and printing it as the rating. Any target past twenty reviews has been showing
 * a wrong number, today, on a live page. The property equivalent prevented a defect; this one fixes
 * one.
 *
 * `avg` is **null**, not 0, when `count` is 0 — no rating is not a rating of zero. `dist` is a
 * 0-based five-slot array and is always five entries long. `catAvg` is sparse: an aspect nobody
 * rated is absent, and each present aspect is averaged over the reviews that answered *it*.
 *
 * **A rejected promise here means "we do not know the rating", never "there are no reviews".** The
 * distinction is the whole reason this is a separate read: an entity id the server does not
 * recognise 404s, and a caller that catches that into a zero-shaped summary re-creates the outage
 * that hid behind "no reviews yet" on every property page for weeks. Callers must render a
 * failed read as unavailable, not as unreviewed.
 *
 * @param {'society'|'locality'|'owner'} entityType
 * @param {string} entityId slug or id for society, slug for locality, user id for owner
 * @returns {Promise<{count: number, avg: number|null, dist: number[], catAvg: object}>}
 */
export const getEntityReviewSummary = async (entityType, entityId) =>
  (await provider()).getEntityReviewSummary(entityType, entityId);

/** Rate a society, locality or owner. Resolves to the created review. */
export const createEntityReview = async (entityType, entityId, review) =>
  (await provider()).createEntityReview(entityType, entityId, review);
