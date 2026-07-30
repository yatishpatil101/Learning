/**
 * Property Service — public API for property operations.
 * Components import from here. Implementation delegates to active provider.
 */
import { createProvider } from './config.js';

const provider = createProvider('property');

// Public discovery
export const listProperties = (filters, sort) => provider().listProperties(filters, sort);
export const getProperty = (id) => provider().getProperty(id);
export const featuredProperties = (limit) => provider().featuredProperties(limit);

/**
 * How many listings match `filters` — **without** transferring them.
 *
 * Pages that only ever render a number ("142 homes in Baner") were fetching the whole catalogue and
 * calling `.length`, which is exact on 38 mock rows and quietly wrong against a paginated API: the
 * count silently becomes "however many fitted in one page". This is the aggregate that mattered
 * most, because a wrong number looks like a fact rather than a bug.
 */
export const countProperties = (filters) => provider().countProperties(filters);

/** Resolve several listings by id, skipping any that no longer exist. Order follows `ids`. */
export const getPropertiesByIds = (ids) => provider().getPropertiesByIds(ids);

/**
 * The signed-in owner's own listings, **at every status**.
 *
 * Not expressible as a `listProperties` filter: public search is hard-floored to approved server-side,
 * so an owner's pending or rejected posts are invisible to it. Deriving "mine" by fetching the public
 * catalogue and matching on owner mobile therefore cannot work against the API — the rows simply
 * aren't in the response — which is why this is its own operation rather than a filter.
 */
export const myListings = (user) => provider().myListings(user);

// Owner: create listing (goes to global DB as pending)
export const addListing = (listing) => provider().addListing(listing);

// Admin: moderation
export const setListingStatus = (id, status) => provider().setListingStatus(id, status);
export const toggleFeatured = (id) => provider().toggleFeatured(id);
export const flagListing = (id, reason) => provider().flagListing(id, reason);
export const clearFlag = (id) => provider().clearFlag(id);
export const deleteListing = (id) => provider().deleteListing(id);
export const updateListingFields = (id, patch) => provider().updateListingFields(id, patch);

// Admin/owner: soft-delete. Backed by PATCH /properties/{id}/archive|restore in http mode.
export const archiveListing = (id, reason) => provider().archiveListing(id, reason);
export const restoreListing = (id) => provider().restoreListing(id);
