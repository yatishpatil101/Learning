/**
 * Review Service — ratings written by users about a property, a society, a locality or an owner.
 *
 * ## One table, two routes, and why the split is in the contract
 *
 * The server serves reviews from two endpoints, not one:
 *
 *   GET|POST /reviews/property/{propertyId}      → `listPropertyReviews` / `createPropertyReview`
 *   GET|POST /reviews/{entityType}/{entityId}    → `listEntityReviews`   / `createEntityReview`
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
 *                  are mock user ids, and the server keys on its own user UUIDs. `Owner.jsx` is
 *                  therefore deliberately still on the mock store: pointing it at this service
 *                  would make it issue a well-formed request for an owner the server has never
 *                  heard of and render the empty result as "no reviews yet", which is worse than
 *                  not migrating it. It moves when the owner profile does.
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
export const listPropertyReviews = (propertyId, opts) =>
  provider().listPropertyReviews(propertyId, opts);

/**
 * Rate a property.
 *
 * Eligibility (a completed visit or a tenancy) is enforced server-side; the page checks it too so
 * the button can explain itself, but the check that counts is the one the caller cannot skip.
 *
 * @param {string} propertyId
 * @param {{rating: number, text?: string, categories?: object, recommend?: boolean|null}} review
 */
export const createPropertyReview = (propertyId, review) =>
  provider().createPropertyReview(propertyId, review);

/**
 * Reviews of a society, locality or owner.
 *
 * @param {'society'|'locality'|'owner'} entityType
 * @param {string} entityId slug for society and locality; see the module note on owner
 */
export const listEntityReviews = (entityType, entityId, opts) =>
  provider().listEntityReviews(entityType, entityId, opts);

/** Rate a society, locality or owner. Resolves to the created review. */
export const createEntityReview = (entityType, entityId, review) =>
  provider().createEntityReview(entityType, entityId, review);
