/* Preferences that belong to this browser, not to the account.
   ==============================================================

   Recently-viewed properties and the return-to-search snapshot are a record of what *this browser*
   did. They are not facts about the user's account, and nothing on the server needs them: no screen
   outside this device reads them, no report counts them, and no other user is affected by them.
   Sending them to the API would therefore buy nothing — while creating a server-side log of one
   person's browsing history, which is precisely the kind of data that has to be justified before it
   is collected, retained and eventually breached. There is no justification here, so it is not
   collected.

   The alternative considered was moving them onto the account so they follow a user between
   devices. Rejected: cross-device continuity of a "recently viewed" rail is a small convenience,
   and it is bought with a permanent record of every listing a person opened. It also gets worse
   the moment a device is shared, which in this market is common — a household browsing on one
   phone would find its history following each of them onto their own.

   **Recent searches are the exception, and only for signed-in visitors.** That rail is a stated
   promise of continuity rather than a passive trail — the key below is bucketed by mobile, which
   already claims "your searches, per account", and a browser is the one place that cannot honour
   it. It now lives on the account, behind `services/recentSearchService.js`. What stays here is the
   *anonymous* rail, which has no account to attach to and no second device to reach. The service is
   what decides between the two; nothing else should read the functions below directly.

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
const APP_PREF_KEY = 'dzAppPrefs';

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
  document.documentElement.classList.toggle('dz-reduce-motion', !!prefs.reduceMotion);
  return prefs;
};

/* =========================================================================
   Recent activity (home page) — recently viewed properties + recent searches.
   Per-user, capped MRU lists. Bucketed by mobile so two people sharing a
   browser do not read each other's trail; 'anon' holds the signed-out one.
   ========================================================================= */
const recentPropsKey = () => 'dzRecentProps:' + (myMobile() || 'anon');
export const getRecentProps = () => read(recentPropsKey(), []);
export const pushRecentProp = (id) => {
  if (!id) return getRecentProps();
  const arr = getRecentProps().filter((x) => x !== id);
  arr.unshift(id);
  return write(recentPropsKey(), arr.slice(0, 8));
};

/* The device-local rail. Reached through `services/recentSearchService.js`, which sends signed-in
   visitors to the server instead — so on the live path the `<mobile>` bucket is now only ever
   `anon`. In mock mode it is still written under a real mobile, because the mock provider has
   nowhere else to put an account's rail. The per-account key is kept for both reasons, and so that
   a browser still holding a signed-in trail from before the migration keeps it separate rather
   than merging it into the anonymous one.

   Dedupe is by **url**, matching the server. By label was wrong and was quietly losing searches:
   "3 BHK in Baner" typed once with a budget filter and once without produces the same label and two
   genuinely different result sets, and the second silently replaced the first.

   The compare is a raw string compare where the server compares a *normalised* url with its query
   parameters sorted. That is not drift in practice: `paramsFromTokens` emits a fixed key order
   (`loc`, `soc`, then the proximity pair) and `HeroSearch` always sets `deal` first, so the same
   search produces the same string every time. Re-ordering only happens when the *values* differ
   (`loc=baner,kothrud` vs `loc=kothrud,baner`), which the server treats as two searches too.

   No path allowlist here, unlike the server's. This store is not a trust boundary: the only writer
   is our own submit handler, and anyone able to put an off-site URL in it can already run script on
   the origin, at which point a chip is the least of it. Restating the server's rule here would give
   two copies to keep in step and no protection in exchange. */
const recentSearchKey = () => 'dzRecentSearches:' + (myMobile() || 'anon');
export const getRecentSearches = () => read(recentSearchKey(), []);
export const pushRecentSearch = (rec) => {
  if (!rec || !rec.label || !rec.url) return getRecentSearches();
  const arr = getRecentSearches().filter((s) => s.url !== rec.url);
  arr.unshift({ label: rec.label, url: rec.url, at: Date.now() });
  return write(recentSearchKey(), arr.slice(0, 6));
};

/* =========================================================================
   Return-to-search context (per browser tab)
   Lets the property page send the user back to the exact listings view — map,
   selected areas, filters, open property and scroll — they came from. Kept in
   sessionStorage so it survives a route change AND a refresh, but not a new tab.
   ========================================================================= */
const LAST_SEARCH_KEY = 'draazyLastSearch';
export const setLastSearch = (ctx) => {
  try { sessionStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(ctx)); } catch { /* ignore */ }
};
export const getLastSearch = () => {
  try { return JSON.parse(sessionStorage.getItem(LAST_SEARCH_KEY)); } catch { return null; }
};
