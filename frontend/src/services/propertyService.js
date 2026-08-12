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

// Owner: create listing (goes to global DB as pending)
export const addListing = async (listing) => (await provider()).addListing(listing);

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

export const deleteListing = async (id) => (await provider()).deleteListing(id);
export const updateListingFields = async (id, patch) => (await provider()).updateListingFields(id, patch);

// Admin/owner: soft-delete. Backed by PATCH /properties/{id}/archive|restore in http mode.
export const archiveListing = async (id, reason) => (await provider()).archiveListing(id, reason);
export const restoreListing = async (id) => (await provider()).restoreListing(id);
