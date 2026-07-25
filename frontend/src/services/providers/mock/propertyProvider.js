/**
 * Mock property provider — wraps mockApi.js and properties-admin.js
 * All functions return Promises (mockApi already does; admin functions wrapped).
 */
import {
  listProperties as _listProperties,
  getProperty as _getProperty,
  featuredProperties as _featuredProperties,
  addListing as _addListing,
  setListingStatus as _setListingStatus,
  toggleFeatured as _toggleFeatured,
} from '../../../lib/mockApi.js';

import {
  flagListing as _flagListing,
  clearFlag as _clearFlag,
  deleteListing as _deleteListing,
  updateListingFields as _updateListingFields,
} from '../../../lib/data/properties-admin.js';

// Already async (returns Promise)
export const listProperties = _listProperties;
export const getProperty = _getProperty;
export const featuredProperties = _featuredProperties;
export const addListing = _addListing;
export const setListingStatus = _setListingStatus;
export const toggleFeatured = _toggleFeatured;

// Sync → async wrappers
export const flagListing = (id, reason) => Promise.resolve(_flagListing(id, reason));
export const clearFlag = (id) => Promise.resolve(_clearFlag(id));
export const deleteListing = (id) => Promise.resolve(_deleteListing(id));
export const updateListingFields = (id, patch) => Promise.resolve(_updateListingFields(id, patch));
