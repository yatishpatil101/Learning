import { createProvider } from './config.js';

const provider = createProvider('property');

export const listProperties = async (filters, sort) => (await provider()).listProperties(filters, sort);
export const getProperty = async (id) => (await provider()).getProperty(id);
export const featuredProperties = async (limit) => (await provider()).featuredProperties(limit);

// `verifiedOwners` counts distinct people, which no page can derive. `localitySlug` is optional.
export const trustStats = async (localitySlug) => (await provider()).trustStats(localitySlug);

/** The public seller card. `null` when the owner is unknown, malformed or archived. */
export const ownerProfile = async (id) => (await provider()).ownerProfile(id);

/** One owner's live listings, as cards — approved and unarchived only, on both providers. */
export const ownerListings = async (id) => (await provider()).ownerListings(id);

// Counts without transferring: `.length` over a fetched page silently reports "however many fitted
// in one page", and a wrong number reads as a fact.
export const countProperties = async (filters) => (await provider()).countProperties(filters);

/** Resolve several listings by id, skipping ids the server does not know. Order follows `ids`. */
export const getPropertiesByIds = async (ids) => (await provider()).getPropertiesByIds(ids);

// Separate from `listProperties` because `{ total, verifiedTotal, unstatedTotal, pageCount }`
// describe the whole match and cannot be recovered from a page.
export const searchListings = async (query, paging) => (await provider()).searchListings(query, paging);

// Its own operation, not a flag: public search 403s no one and `/admin/properties` 403s non-staff.
export const listForModeration = async (filters, sort) => (await provider()).listForModeration(filters, sort);

// Use wherever a number is shown to an operator, and because `filters.q` is answered by the
// database rather than by the fetched page.
export const searchForModeration = async (filters, sort, paging) =>
  (await provider()).searchForModeration(filters, sort, paging);

// Never derive these from a fetched page: a page of pending rows paints `Active 0`, which is read
// as "nothing is live".
export const moderationSummary = async () => (await provider()).moderationSummary();

// Not a `listProperties` filter: public search is hard-floored to approved server-side, so pending
// or rejected rows are not in that response.
export const myListings = async (user) => (await provider()).myListings(user);

// Resolves `null` when it is not the caller's — existence is itself owner-only knowledge. Returns
// the edit-form shape the buyer view omits.
export const myListing = async (id, user) => (await provider()).myListing(id, user);

/** Owner: create a listing. It enters the catalogue as `pending`. */
export const addListing = async (listing) => (await provider()).addListing(listing);

// Scoped to the caller's own listings. The address must be composed exactly as `toListingCreate`
// does, or the key names another property.
export const checkOwnDuplicate = async (fields) => (await provider()).checkOwnDuplicate(fields);

// Its own operation because who owns the record is not a flag. `ownerMobile` is the identity;
// `ownerName` applies only to a new account.
export const createListingOnBehalf = async (ownerMobile, ownerName, listing) =>
  (await provider()).createListingOnBehalf(ownerMobile, ownerName, listing);

// Advisory only — never block the form on it; `known: false` is the ordinary first-call answer.
export const ownerListingStanding = async (mobile) =>
  (await provider()).ownerListingStanding(mobile);

// `truncated` must be rendered — a capped clustering looks clean, and "no duplicates found" would
// then be a lie.
export const listDuplicateClusters = async () =>
  (await provider()).listDuplicateClusters();

// No useful body: the cluster it acted on has ceased to exist, so the caller must re-read the desk.
// The kept row is untouched.
export const mergeDuplicateCluster = async (keepId, dropIds) =>
  (await provider()).mergeDuplicateCluster(keepId, dropIds);

// The verdict keys on that exact member set, so a later colliding listing forms a different set and
// is correctly asked again. Idempotent.
export const dismissDuplicateCluster = async (ids) =>
  (await provider()).dismissDuplicateCluster(ids);

// Admin moderation: all four need a staff/admin session and the API returns no body, so callers
// must re-read the list rather than trust the resolved value.

// `reason` lands on the audit row, which is what makes a rejection reviewable. `flagged` and
// `archived` are `flagListing`/`archiveListing`.
export const setListingStatus = async (id, status, reason) => (await provider()).setListingStatus(id, status, reason);

/** Toggle homepage merchandising. No status precondition on either side. */
export const toggleFeatured = async (id) => (await provider()).toggleFeatured(id);

/** Raise a moderation flag — takes the listing off the public site and records the reason. */
export const flagListing = async (id, reason) => (await provider()).flagListing(id, reason);

// **Publishes the listing**: status becomes `approved`, not whatever it was before being flagged.
export const clearFlag = async (id) => (await provider()).clearFlag(id);

// The server sorts acquisition stage from hand-back milestone. `under_review`/`live` are `status`
// read sideways and are refused with a 400.
export const setPipelineStage = async (id, stage) => (await provider()).setPipelineStage(id, stage);

export const deleteListing = async (id) => (await provider()).deleteListing(id);
export const updateListingFields = async (id, patch) => (await provider()).updateListingFields(id, patch);

// The owner withdraws their own listing, no reason owed. Soft, since enquiries and deals still
// point at the row. This exits the quota.
export const takeListingDown = async (id, user) => (await provider()).takeListingDown(id, user);

// Audited, cross-owner, and unlike the owner-scoped `updateListingFields` it does not revert the
// listing to `pending`.
export const updateListingAsModerator = async (id, patch) => (await provider()).updateListingAsModerator(id, patch);

// Admin/owner: soft-delete. Backed by PATCH /properties/{id}/archive|restore in http mode.
export const archiveListing = async (id, reason) => (await provider()).archiveListing(id, reason);
export const restoreListing = async (id) => (await provider()).restoreListing(id);

// Its own operation because an edit can revert a listing to `pending`, and answering the
// anti-staleness nudge must not take it out of search.
export const confirmListingFresh = async (id) => (await provider()).confirmListingFresh(id);
