/**
 * Mock owner-listing provider — wraps store.js per-user listing functions
 */
import {
  getListings as _getListings,
  hasListings as _hasListings,
  getListing as _getListing,
  addListing as _addListing,
  updateListing as _updateListing,
  isListingApproved as _isListingApproved,
  listingFoundationChanged as _listingFoundationChanged,
  revertListingForReview as _revertListingForReview,
} from '../../../lib/store.js';

export const getListings = () => Promise.resolve(_getListings());
export const hasListings = () => Promise.resolve(_hasListings());
export const getListing = (id) => Promise.resolve(_getListing(id));
export const addListing = (l) => Promise.resolve(_addListing(l));
export const updateListing = (id, patch) => Promise.resolve(_updateListing(id, patch));
export const isListingApproved = (id) => Promise.resolve(_isListingApproved(id));
export const listingFoundationChanged = (oldL, patch) => _listingFoundationChanged(oldL, patch); // pure sync — no API needed
export const revertListingForReview = (id) => Promise.resolve(_revertListingForReview(id));
