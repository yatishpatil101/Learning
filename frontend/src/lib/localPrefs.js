/* Preferences that belong to this browser, not to the account.
   ==============================================================

   Recently-viewed properties, recent searches and the return-to-search snapshot are a record of
   what *this browser* did. They are not facts about the user's account, and nothing on the server
   needs them: no screen outside this device reads them, no report counts them, and no other user
   is affected by them. Sending them to the API would therefore buy nothing — while creating a
   server-side log of one person's browsing history, which is precisely the kind of data that has
   to be justified before it is collected, retained and eventually breached. There is no
   justification here, so it is not collected.

   The alternative considered was moving them onto the account so they follow a user between
   devices. Rejected: cross-device continuity of a "recently viewed" rail is a small convenience,
   and it is bought with a permanent record of every listing a person opened. It also gets worse
   the moment a device is shared, which in this market is common — a household browsing on one
   phone would find its search history following each of them onto their own.

   These stay client-local permanently. They live here rather than in `lib/store/` so that deleting
   the prototype's mock database does not take them with it; unlike everything in there, none of
   this is standing in for a server table.

   Storage keys are unchanged and must stay that way — existing browsers hold data under them, and
   the e2e suite asserts against them by name.
*/

import { myMobile } from './contact.js';

/* Read/write helpers, deliberately local rather than shared with the mock store's: these keys
   outlive it. The `pn:store` broadcast is kept because the navbar and the notification provider
   both listen for it, and the native `storage` event only fires in *other* tabs.

   What is not kept is the store's debounced disk snapshot. That is a dev-only convenience which
   sweeps up every `pn*` key whenever anything writes, so these entries still land in it; a browsing
   history is also the last thing worth mirroring to disk for its own sake. */
const read = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pn:store', { detail: { key } }));
  } catch {
    /* quota */
  }
  return value;
};

/* =========================================================================
   Device appearance preferences.

   `reduceMotion` is a fact about this screen and this person's comfort on it, not about their
   account: it is set before anyone signs in, it applies to the signed-out marketing pages, and a
   user who wants stillness on a low-powered phone does not necessarily want it on their desktop.
   Storing it on the server would also mean the first paint could not honour it, because the class
   has to be on `<html>` before anything animates and the API answer arrives after that.
   ========================================================================= */
const APP_PREF_KEY = 'pnAppPrefs';

export const getAppPrefs = () => ({ reduceMotion: false, ...(read(APP_PREF_KEY, {}) || {}) });

export const setAppPrefs = (patch) => {
  const next = { ...getAppPrefs(), ...patch };
  write(APP_PREF_KEY, next);
  applyAppPrefs(next);
  return next;
};

/* Reflect appearance prefs onto `<html>` so CSS can react. Safe to call repeatedly. */
export const applyAppPrefs = (prefs = getAppPrefs()) => {
  if (typeof document === 'undefined') return prefs;
  document.documentElement.classList.toggle('pn-reduce-motion', !!prefs.reduceMotion);
  return prefs;
};

/* =========================================================================
   Recent activity (home page) — recently viewed properties + recent searches.
   Per-user, capped MRU lists. Bucketed by mobile so two people sharing a
   browser do not read each other's trail; 'anon' holds the signed-out one.
   ========================================================================= */
const recentPropsKey = () => 'pnRecentProps:' + (myMobile() || 'anon');
export const getRecentProps = () => read(recentPropsKey(), []);
export const pushRecentProp = (id) => {
  if (!id) return getRecentProps();
  const arr = getRecentProps().filter((x) => x !== id);
  arr.unshift(id);
  return write(recentPropsKey(), arr.slice(0, 8));
};

const recentSearchKey = () => 'pnRecentSearches:' + (myMobile() || 'anon');
export const getRecentSearches = () => read(recentSearchKey(), []);
export const pushRecentSearch = (rec) => {
  if (!rec || !rec.label) return getRecentSearches();
  const arr = getRecentSearches().filter((s) => s.label !== rec.label);
  arr.unshift(Object.assign({ at: Date.now() }, rec));
  return write(recentSearchKey(), arr.slice(0, 6));
};

/* =========================================================================
   Return-to-search context (per browser tab)
   Lets the property page send the user back to the exact listings view — map,
   selected areas, filters, open property and scroll — they came from. Kept in
   sessionStorage so it survives a route change AND a refresh, but not a new tab.
   ========================================================================= */
const LAST_SEARCH_KEY = 'puneNestLastSearch';
export const setLastSearch = (ctx) => {
  try { sessionStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(ctx)); } catch { /* ignore */ }
};
export const getLastSearch = () => {
  try { return JSON.parse(sessionStorage.getItem(LAST_SEARCH_KEY)); } catch { return null; }
};
