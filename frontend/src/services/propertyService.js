/**
 * Property Service — public API for property operations.
 * Components import from here. Implementation delegates to active provider.
 */
import { createProvider } from './config.js';

const provider = createProvider('property');

// Public discovery
export const listProperties = async (filters, sort) => (await provider()).listProperties(filters, sort);
export const getProperty = async (id) => (await provider()).getProperty(id);
export const featuredProperties = async (limit) => (await provider()).featuredProperties(limit);

/**
 * The verified share of the live catalogue — `{ verifiedListings, totalListings, verifiedOwners }`.
 *
 * Counted by whoever holds the catalogue, never by the page. The homepage used to compute these
 * three numbers from the listings it happened to have loaded, which is exact on 38 mock rows and
 * quietly wrong against a paginated API — the same failure `countProperties` exists to prevent.
 *
 * `verifiedOwners` is the one that could not be salvaged client-side at any page size: it counts
 * *distinct people*, and the list response carries no owner id, so the browser cannot tell three
 * flats from one landlord apart from three flats from three.
 *
 * @param {string} [localitySlug] narrow to one locality; omit for the whole catalogue
 */
export const trustStats = async (localitySlug) => (await provider()).trustStats(localitySlug);

/** The public seller card. `null` when the owner is unknown, malformed or archived. */
export const ownerProfile = async (id) => (await provider()).ownerProfile(id);

/** One owner's live listings, as cards — approved and unarchived only, on both providers. */
export const ownerListings = async (id) => (await provider()).ownerListings(id);

/**
 * How many listings match `filters` — **without** transferring them.
 *
 * Pages that only ever render a number ("142 homes in Baner") were fetching the whole catalogue and
 * calling `.length`, which is exact on 38 mock rows and quietly wrong against a paginated API: the
 * count silently becomes "however many fitted in one page". This is the aggregate that mattered
 * most, because a wrong number looks like a fact rather than a bug.
 */
export const countProperties = async (filters) => (await provider()).countProperties(filters);

/** Resolve several listings by id, skipping any that no longer exist. Order follows `ids`. */
export const getPropertiesByIds = async (ids) => (await provider()).getPropertiesByIds(ids);

/**
 * One page of a fully-filtered listings search, plus the two totals that describe the whole match.
 *
 * Separate from `listProperties` for the same reason `listForModeration` is: `listProperties`
 * returns an array and a dozen callers aggregate over it, whereas this returns
 * `{ items, total, verifiedTotal, pageCount }` and only the listings page wants it.
 *
 * The totals are the point. Filtering and paging in the browser meant every one of the listings
 * page's ~25 filters really said "of the first 100 listings", and both the result count and the
 * "N verified" beside it described a page while reading as facts about the catalogue. Those two
 * numbers cannot be recovered from a page of results, so they come off the response.
 */
export const searchListings = async (query, paging) => (await provider()).searchListings(query, paging);

/**
 * Every listing at every status, **including archived** — the moderation queue. Staff/admin only.
 *
 * Deliberately a separate operation rather than `listProperties({ includeAllStatuses: true })`,
 * which is what it looked like it should be. Against the API these are two different endpoints with
 * two different authorizations: public search is hard-floored to approved and takes no principal, so
 * it *cannot* be widened, while `/admin/properties` 403s anyone without a staff role.
 *
 * Inferring the routing from those flags was tried and was wrong: `useDashboardData.js` passes
 * `includeAllStatuses: true` on a consumer page — it wants a catalogue to resolve visit titles
 * against — so every owner opening their dashboard was routed to the staff endpoint and got a 403.
 * An authorization-relevant choice has to be named by the caller, not guessed from a flag.
 */
export const listForModeration = async (filters, sort) => (await provider()).listForModeration(filters, sort);

/**
 * The signed-in owner's own listings, **at every status**.
 *
 * Not expressible as a `listProperties` filter: public search is hard-floored to approved server-side,
 * so an owner's pending or rejected posts are invisible to it. Deriving "mine" by fetching the public
 * catalogue and matching on owner mobile therefore cannot work against the API — the rows simply
 * aren't in the response — which is why this is its own operation rather than a filter.
 */
export const myListings = async (user) => (await provider()).myListings(user);

/**
 * One of the signed-in owner's own listings, at any status.
 *
 * Distinct from `getProperty` for the same reason `myListings` is distinct from `listProperties`: a
 * listing under moderation is not on the public endpoint at all, and the public view model is built
 * for buyers, so it omits the fields the edit form needs to put back. Resolves `null` when the
 * listing is not the caller's — the server answers 404 there, because whether a listing exists is
 * itself something only its owner is entitled to learn.
 */
export const myListing = async (id, user) => (await provider()).myListing(id, user);

// Owner: create listing (goes to global DB as pending)
export const addListing = async (listing) => (await provider()).addListing(listing);

/**
 * "Have I already listed this?" — asked by the wizard before it submits.
 *
 * Scoped to the caller's own listings, which is the whole change. The wizard used to answer this
 * itself, out of `evaluateListingDedup`, by scanning the listings the browser's local store happened
 * to hold. Against a live API that store is the seeded demo catalogue, so the guard could refuse a
 * real owner over a fixture and then offer to open an id the server had never issued — it blocked
 * the wrong people and sent them to a blank form.
 *
 * `fields` are the wizard's, not the wire's: the provider composes the address the same way
 * `toListingCreate` does, because the server derives the comparison key from that string and a
 * different composition here would answer about a different property than the one about to be
 * posted.
 *
 * Resolves `{ found, existingId }`. It never throws for "yes" — a duplicate is an answer, not an
 * error — so a caller that only cares about the block reads `found`.
 */
export const checkOwnDuplicate = async (fields) => (await provider()).checkOwnDuplicate(fields);

/**
 * Staff: create a listing on somebody else's behalf, attributed to them.
 *
 * A separate operation rather than `addListing` with a couple of extra fields, because the two
 * differ in who ends up owning the record and that is not something a caller should express with a
 * flag. `addListing` attributes what it creates to the caller — posting a concierge listing through
 * it gave the staff member a listing of their own, invisible to the owner it was taken for, while
 * the `postedByAdmin` and `postedByStaff` fields the console packed into the body were discarded
 * server-side. A client does not get to name an owner or an actor.
 *
 * `ownerMobile` is the identity, not an id: the operator is on a call with somebody who has never
 * signed in. `ownerName` is a fallback used only when the account has to be created — for an
 * existing account it is ignored, so a name heard over a phone call cannot overwrite the one the
 * owner typed themselves.
 */
export const createListingOnBehalf = async (ownerMobile, ownerName, listing) =>
  (await provider()).createListingOnBehalf(ownerMobile, ownerName, listing);

/**
 * Staff: how much of their listing ceiling one owner is already using.
 *
 * Only exists because `createListingOnBehalf` stopped being refused by that ceiling. The desk used
 * to inherit the owner's freemium cap, so an operator on a call with somebody who owns three flats
 * could record one of them and was refused the rest — with the owner's own wizard copy, addressed
 * to a member of staff, about an account that is not theirs. Exempting the desk fixed that; this is
 * how the operator still gets told, so they can raise the upgrade on the call they are already on.
 *
 * Advisory, and the caller must treat it that way. Nothing here blocks the form: a desk that cannot
 * take a listing because a count did not load is worse than one that takes it without the note.
 *
 * Resolves `{ mobile, known, allowance, held, overAllowance }`. `known: false` is the ordinary
 * answer on a first call, not a failure — most people the desk speaks to have never signed in.
 * `mobile` is echoed back so a caller can drop a response that arrived after the field moved on.
 */
export const ownerListingStanding = async (mobile) =>
  (await provider()).ownerListingStanding(mobile);

// Admin: moderation.
//
// All four resolve when the change has been applied and throw when it has not. They do **not**
// resolve to a useful value: the API returns no body for any of them (a moderator can predict the
// effect of the request they sent, and the caller re-reads the list afterwards), while the mock
// still returns the updated record. A caller that reads the resolved value therefore works on mocks
// and silently reads `undefined` against the API — so nothing may.
//
// Reaching any of these requires a staff/admin session; a seeker's token gets a 403.

/**
 * Approve, reject, or send a listing back to pending.
 *
 * `reason` is recorded on the server's audit row and is what makes a rejection reviewable
 * afterwards — the mock ignores it, but omitting it against the API would leave "why was this
 * rejected" answerable only by asking the moderator.
 *
 * Only `pending | approved | rejected` are accepted. `flagged` belongs to {@link flagListing},
 * which also records why, and `archived` to {@link archiveListing}, which is owner-or-staff rather
 * than staff-only; both are separate operations rather than status values.
 */
export const setListingStatus = async (id, status, reason) => (await provider()).setListingStatus(id, status, reason);

/** Toggle homepage merchandising. No status precondition on either side. */
export const toggleFeatured = async (id) => (await provider()).toggleFeatured(id);

/** Raise a moderation flag — takes the listing off the public site and records the reason. */
export const flagListing = async (id, reason) => (await provider()).flagListing(id, reason);

/**
 * Clear a moderation flag. **Publishes the listing** — status becomes `approved`, it is not
 * restored to whatever it was before being flagged. Both providers behave this way.
 */
export const clearFlag = async (id) => (await provider()).clearFlag(id);

/**
 * Move a staff-posted listing along one of the two concierge funnels (D27).
 *
 * `stage` is either an acquisition stage — `contacted | info_collected | listed | docs_submitted`,
 * where the desk has got to — or a hand-back milestone — `photos_uploaded | aadhaar_verified |
 * claim_sent | claimed`, where the owner has got to once the desk handed the listing over. The
 * server keeps them in two columns and works out which one you meant, so callers pass a single
 * value; sending a hand-back milestone also pins the acquisition stage at `docs_submitted`, and
 * sending an acquisition stage clears the milestone.
 *
 * `under_review` and `live` are **not** stages and are refused with a 400. They are `status` read
 * sideways (`pending` and `approved`), and the board derives those two columns rather than storing
 * them — a listing cannot be approved and "not yet Live" at the same time. Anything wanting to move
 * a listing into either belongs in {@link setListingStatus} or the review decision.
 *
 * Resolves with **no value** on both providers, like the four moderation decisions above.
 */
export const setPipelineStage = async (id, stage) => (await provider()).setPipelineStage(id, stage);

export const deleteListing = async (id) => (await provider()).deleteListing(id);
export const updateListingFields = async (id, patch) => (await provider()).updateListingFields(id, patch);

/**
 * The signed-in owner withdraws their own listing.
 *
 * Distinct from {@link archiveListing}, which is the moderator's route and takes a reason: staff
 * pulling a listing owe its owner an explanation, and an owner withdrawing their own owes nobody
 * one. Soft on both providers — the row survives for the enquiries and deals that point at it,
 * because a listing is not only the owner's once buyers have contacted it.
 *
 * This is the exit from the listing quota. The free tier is one listing *at a time*, and until
 * there was a way to let go of one, "at a time" meant "ever". Resolves with the withdrawn listing.
 */
export const takeListingDown = async (id, user) => (await provider()).takeListingDown(id, user);

/**
 * Staff/admin: correct **somebody else's** listing in place.
 *
 * Separate from {@link updateListingFields} because the two are different routes with different
 * rules, not the same write under two names. `updateListingFields` is `/me/listings/{id}` and is
 * owner-scoped, so a moderator calling it about a stranger's listing gets a 404 by design. This one
 * is `PATCH /properties/{id}/admin`: cross-owner, audited, and — the behavioural difference that
 * matters — it does **not** revert the listing to `pending`. Re-moderation exists so an owner's
 * change is seen by a moderator before it goes live; here the moderator *is* the change, and
 * reverting would push their own correction into their own queue.
 */
export const updateListingAsModerator = async (id, patch) => (await provider()).updateListingAsModerator(id, patch);

// Admin/owner: soft-delete. Backed by PATCH /properties/{id}/archive|restore in http mode.
export const archiveListing = async (id, reason) => (await provider()).archiveListing(id, reason);
export const restoreListing = async (id) => (await provider()).restoreListing(id);

/**
 * Owner: "yes, this listing is still available" — the anti-staleness heartbeat (V86).
 *
 * Backed by `POST /me/listings/{id}/confirm-available` in http mode. Its own operation rather than
 * a field on {@link updateListingFields} because an edit can revert a listing to `pending`, and an
 * owner answering the freshness nudge must never take their own listing out of search to do it.
 *
 * Resolves with the updated listing, so a caller can re-derive the badge from what came back rather
 * than assuming the write landed.
 */
export const confirmListingFresh = async (id) => (await provider()).confirmListingFresh(id);
