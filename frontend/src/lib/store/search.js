import { digits, myMobile } from '../contact.js';
import { get, set } from './internals.js';

/* =========================================================================
   Saved searches + alerts
   ========================================================================= */
const savedSearchKey = (mobile) => 'pnSavedSearches:' + (digits(mobile || '') || myMobile() || 'anon');
export const getSavedSearches = () => get(savedSearchKey(), []);
export const addSavedSearch = (o) => {
  const rec = { id: 'ss' + Date.now(), alerts: true, channel: 'whatsapp', at: Date.now(), newCount: 0, ...o };
  // Key by the record's own mobile when provided (e.g. a signed-out lead entering
  // their number) so the alert lands under that user and surfaces in their dashboard
  // after they sign in — instead of being orphaned under 'anon'.
  const key = savedSearchKey(rec.mobile);
  const arr = get(key, []);
  arr.unshift(rec);
  set(key, arr);
  return rec;
};
export const removeSavedSearch = (id) => set(savedSearchKey(), getSavedSearches().filter((s) => s.id !== id));
/* Write the whole list back. The provider needs this to patch a record's alert fields: without it
   the only write primitive is `toggleSearchAlert`, which flips a boolean and so cannot express the
   server's four-state `alertFrequency` at all. */
export const saveSavedSearches = (arr) => set(savedSearchKey(), arr);
export const toggleSearchAlert = (id) => {
  const arr = getSavedSearches();
  arr.forEach((s) => { if (s.id === id) s.alerts = !s.alerts; });
  set(savedSearchKey(), arr);
};

/* =========================================================================
   Recent activity (home page) — recently viewed properties + recent searches.
   Lightweight, per-user, capped MRU lists. Prototype only (localStorage).
   ========================================================================= */
const recentPropsKey = () => 'pnRecentProps:' + (myMobile() || 'anon');
export const getRecentProps = () => get(recentPropsKey(), []);
export const pushRecentProp = (id) => {
  if (!id) return getRecentProps();
  const arr = getRecentProps().filter((x) => x !== id);
  arr.unshift(id);
  return set(recentPropsKey(), arr.slice(0, 8));
};

const recentSearchKey = () => 'pnRecentSearches:' + (myMobile() || 'anon');
export const getRecentSearches = () => get(recentSearchKey(), []);
export const pushRecentSearch = (rec) => {
  if (!rec || !rec.label) return getRecentSearches();
  const arr = getRecentSearches().filter((s) => s.label !== rec.label);
  arr.unshift(Object.assign({ at: Date.now() }, rec));
  return set(recentSearchKey(), arr.slice(0, 6));
};

