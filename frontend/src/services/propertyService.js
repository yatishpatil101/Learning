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
 * Verified share of the catalogue; `verifiedOwners` counts distinct people, which no page can derive.
 * @param {string} [localitySlug] narrow to one locality; omit for the whole catalogue
 */
export const trustStats = async (localitySlug) => (await provider()).trustStats(localitySlug);

/** The public seller card. `null` when the owner is unknown, malformed or archived. */
export const ownerProfile = async (id) => (await provider()).ownerProfile(id);

/** One owner's live listings, as cards — approved and unarchived only, on both providers. */
export const ownerListings = async (id) => (await provider()).ownerListings(id);

/**
 * How many listings match `filters`, without transferring them: `.length` over a fetched page
 * silently reports "however many fitted in one page", and a wrong number reads as a fact.
 */
export const countProperties = async (filters) => (await provider()).countProperties(filters);

/** Resolve several listings by id, skipping ids the server does not know. Order follows `ids`. */
export const getPropertiesByIds = async (ids) => (await provider()).getPropertiesByIds(ids);

/**
 * One page of a filtered search plus `{ total, verifiedTotal, pageCount }`. Separate from
 * `listProperties` because those totals describe the whole match and cannot be recovered from a page.
 */
export const searchListings = async (query, paging) => (await provider()).searchListings(query, paging);

/**
 * Every listing at every status, including archived — the staff/admin moderation queue. Its own
 * operation because public search 403s no one and `/admin/properties` 403s non-staff: not a flag.
 */
export const listForModeration = async (filters, sort) => (await provider()).listForModeration(filters, sort);

/**
 * One page of the moderation queue plus `{ total, pageCount }` — use wherever a number is shown to
 * an operator, and because `filters.q` is answered by the database rather than the fetched page.
 */
export const searchForModeration = async (filters, sort, paging) =>
  (await provider()).searchForModeration(filters, sort, paging);

/**
 * Console headline counts over the whole catalogue. Never derive these from a fetched page: a
 * page of pending rows paints `Active 0`, which is read as "nothing is live".
 */
export const moderationSummary = async () => (await provider()).moderationSummary();

/**
 * The signed-in owner's own listings, at every status. Not a `listProperties` filter: public search
 * is hard-floored to approved server-side, so pending or rejected rows are not in that response.
 */
export const myListings = async (user) => (await provider()).myListings(user);

/**
 * One of the owner's own listings at any status, in the edit-form shape the buyer view omits.
 * Resolves `null` when it is not the caller's: existence is itself owner-only knowledge.
 */
export const myListing = async (id, user) => (await provider()).myListing(id, user);

// Owner: create listing (goes to global DB as pending)
export const addListing = async (listing) => (await provider()).addListing(listing);

/**
 * "Have I already listed this?", scoped to the caller's own listings. `fields` are the wizard's:
 * the address must be composed exactly as `toListingCreate` does or the key names another property.
 */
export const checkOwnDuplicate = async (fields) => (await provider()).checkOwnDuplicate(fields);

/**
 * Staff: create a listing attributed to someone else — its own operation because who owns the
 * record is not a flag. `ownerMobile` is the identity; `ownerName` applies only to a new account.
 */
export const createListingOnBehalf = async (ownerMobile, ownerName, listing) =>
  (await provider()).createListingOnBehalf(ownerMobile, ownerName, listing);

/**
 * Staff: how much of an owner's listing ceiling is used, so the upgrade can be raised on the call.
 * Advisory only — never block the form on it; `known: false` is the ordinary first-call answer.
 */
export const ownerListingStanding = async (mobile) =>
  (await provider()).ownerListingStanding(mobile);

/**
 * Staff: listings that look like the same property, grouped. `truncated` must be rendered — a
 * capped clustering looks clean, and "no duplicates found" would then be a lie.
 */
export const listDuplicateClusters = async () =>
  (await provider()).listDuplicateClusters();

/**
 * Staff: keep one listing in a cluster and archive the rest. No useful body — the cluster it acted
 * on has ceased to exist, so the caller's next move is to re-read the desk. The kept row is untouched.
 */
export const mergeDuplicateCluster = async (keepId, dropIds) =>
  (await provider()).mergeDuplicateCluster(keepId, dropIds);

/**
 * Staff: a cluster is a coincidence. The verdict keys on that exact member set, so a later colliding
 * listing forms a different set and is correctly asked again. Idempotent.
 */
export const dismissDuplicateCluster = async (ids) =>
  (await provider()).dismissDuplicateCluster(ids);

// Admin: moderation. All four need a staff/admin session and resolve with no useful value — the
// API returns no body, so callers must re-read the list rather than trust the resolved value.

/**
 * Approve, reject, or send a listing back to pending; `reason` lands on the audit row, which is
 * what makes a rejection reviewable. `flagged` and `archived` are {@link flagListing}/{@link archiveListing}.
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
 * Move a staff-posted listing along a concierge funnel; the server sorts acquisition stage from
 * hand-back milestone. `under_review`/`live` are `status` read sideways and are refused with a 400.
 */
export const setPipelineStage = async (id, stage) => (await provider()).setPipelineStage(id, stage);

export const deleteListing = async (id) => (await provider()).deleteListing(id);
export const updateListingFields = async (id, patch) => (await provider()).updateListingFields(id, patch);

/**
 * The owner withdraws their own listing — no reason owed, unlike the moderator's {@link archiveListing}.
 * Soft on both providers, since enquiries and deals still point at the row. This exits the quota.
 */
export const takeListingDown = async (id, user) => (await provider()).takeListingDown(id, user);

/**
 * Staff/admin: correct somebody else's listing in place — a different, audited, cross-owner route
 * from the owner-scoped {@link updateListingFields}, and one that does not revert it to `pending`.
 */
export const updateListingAsModerator = async (id, patch) => (await provider()).updateListingAsModerator(id, patch);

// Admin/owner: soft-delete. Backed by PATCH /properties/{id}/archive|restore in http mode.
export const archiveListing = async (id, reason) => (await provider()).archiveListing(id, reason);
export const restoreListing = async (id) => (await provider()).restoreListing(id);

/**
 * Owner: "still available" — the anti-staleness heartbeat. Its own operation because an edit can
 * revert a listing to `pending`, and answering the nudge must not take it out of search.
 */
export const confirmListingFresh = async (id) => (await provider()).confirmListingFresh(id);
