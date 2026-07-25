/**
 * Mock saved/preferences provider — wraps store.js saved props/searches + plans/boosts
 */
import {
  getSavedProps as _getSavedProps,
  isSavedProp as _isSavedProp,
  toggleSavedProp as _toggleSavedProp,
  getSavedSearches as _getSavedSearches,
  addSavedSearch as _addSavedSearch,
  removeSavedSearch as _removeSavedSearch,
  toggleSearchAlert as _toggleSearchAlert,
  getPlan as _getPlan,
  setPlan as _setPlan,
  isBoosted as _isBoosted,
  boostListing as _boostListing,
  getServiceOrders as _getServiceOrders,
  addServiceOrder as _addServiceOrder,
} from '../../../lib/store.js';

// Saved properties
export const getSavedProps = () => Promise.resolve(_getSavedProps());
export const isSavedProp = (id) => Promise.resolve(_isSavedProp(id));
export const toggleSavedProp = (id) => Promise.resolve(_toggleSavedProp(id));

// Saved searches
export const getSavedSearches = () => Promise.resolve(_getSavedSearches());
export const addSavedSearch = (o) => Promise.resolve(_addSavedSearch(o));
export const removeSavedSearch = (id) => Promise.resolve(_removeSavedSearch(id));
export const toggleSearchAlert = (id) => Promise.resolve(_toggleSearchAlert(id));

// Plans & boosts
export const getPlan = () => Promise.resolve(_getPlan());
export const setPlan = (p) => Promise.resolve(_setPlan(p));
export const isBoosted = (id) => Promise.resolve(_isBoosted(id));
export const boostListing = (id, days) => Promise.resolve(_boostListing(id, days));

// Service orders
export const getServiceOrders = () => Promise.resolve(_getServiceOrders());
export const addServiceOrder = (o) => Promise.resolve(_addServiceOrder(o));
