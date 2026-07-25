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

// Owner: create listing (goes to global DB as pending)
export const addListing = (listing) => provider().addListing(listing);

// Admin: moderation
export const setListingStatus = (id, status) => provider().setListingStatus(id, status);
export const toggleFeatured = (id) => provider().toggleFeatured(id);
export const flagListing = (id, reason) => provider().flagListing(id, reason);
export const clearFlag = (id) => provider().clearFlag(id);
export const deleteListing = (id) => provider().deleteListing(id);
export const updateListingFields = (id, patch) => provider().updateListingFields(id, patch);
