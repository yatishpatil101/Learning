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
  archiveListing as _archiveListing,
  restoreListing as _restoreListing,
  digits,
} from '../../../lib/data/properties-admin.js';

// Already async (returns Promise)
export const listProperties = _listProperties;
export const getProperty = _getProperty;
export const featuredProperties = _featuredProperties;
export const addListing = _addListing;
export const setListingStatus = _setListingStatus;
export const toggleFeatured = _toggleFeatured;

/**
 * Counting by listing and measuring the result keeps the mock's filter semantics as the single
 * definition of "matches" — a reimplementation here could drift from `matchesFilters` and make the
 * two providers disagree about the very number the http one exists to get right.
 */
export const countProperties = (filters) => _listProperties(filters).then((l) => l.length);

/** Mirrors the http provider: unknown ids are dropped, and the result follows `ids` order. */
export const getPropertiesByIds = (ids = []) =>
  Promise.all(ids.map((id) => _getProperty(id))).then((list) => list.filter(Boolean));

/**
 * The owner's own listings at every status. The mock has no session, so ownership is matched on the
 * last 10 mobile digits (formatting varies across seeded and user-entered numbers); the http
 * provider gets the same set from the access token instead.
 *
 * `real` filters out demo catalogue rows, which have no owner and would otherwise appear in every
 * owner's dashboard.
 */
export const myListings = (user) => {
  const mine = digits(user?.mobile).slice(-10);
  // No identified user means no listings. Without this the `!mine` short-circuit below matches every
  // row, so a transient null user (logout, or a session still restoring) would show one owner every
  // other owner's listings — and it would diverge from http, where ownership is the token's and an
  // absent session simply returns nothing.
  if (!mine) return Promise.resolve([]);
  return _listProperties({ includeAllStatuses: true }, 'newest').then((props) =>
    props.filter((p) => {
      if (!p.real) return false;
      const owner = digits(p.ownerMobile).slice(-10);
      return !owner || owner === mine;
    }));
};

// Sync → async wrappers
export const flagListing = (id, reason) => Promise.resolve(_flagListing(id, reason));
export const clearFlag = (id) => Promise.resolve(_clearFlag(id));
export const deleteListing = (id) => Promise.resolve(_deleteListing(id));
export const updateListingFields = (id, patch) => Promise.resolve(_updateListingFields(id, patch));
export const archiveListing = (id, reason) => Promise.resolve(_archiveListing(id, reason));
export const restoreListing = (id) => Promise.resolve(_restoreListing(id));
