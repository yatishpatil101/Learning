/* Device-local on purpose: syncing browsing history would create a server-side record with no justification.
   Storage keys must stay unchanged: existing browsers hold data under them and e2e asserts them by name. */

import { myMobile } from './contact.js';

/* Read/write helpers, deliberately local. The `pn:store` broadcast is kept because the navbar
   listens for it, and the native `storage` event only fires in *other* tabs. */
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

/* reduceMotion must be on <html> before first paint, which a server answer would arrive too late to honour. */
const APP_PREF_KEY = 'dzAppPrefs';

export const getAppPrefs = () => ({ reduceMotion: false, theme: 'light', ...(read(APP_PREF_KEY, {}) || {}) });

export const setAppPrefs = (patch) => {
  const next = { ...getAppPrefs(), ...patch };
  write(APP_PREF_KEY, next);
  applyAppPrefs(next);
  return next;
};

/* Reflect appearance prefs onto `<html>` so CSS can react. Safe to call repeatedly. index.html
   applies `light` before first paint; keep the two in step. */
export const applyAppPrefs = (prefs = getAppPrefs()) => {
  if (typeof document === 'undefined') return prefs;
  const root = document.documentElement;
  root.classList.toggle('dz-reduce-motion', !!prefs.reduceMotion);
  root.classList.toggle('light', prefs.theme === 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', prefs.theme === 'light' ? '#f3f7f6' : '#0f0d1a');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', prefs.theme === 'light' ? 'light' : 'dark');
  const icon = document.querySelector('link[rel="icon"][data-light]');
  if (icon) {
    icon.dataset.dark ||= icon.href;
    icon.href = prefs.theme === 'light' ? icon.dataset.light : icon.dataset.dark;
  }
  return prefs;
};

/* Capped MRU lists bucketed by mobile so two people sharing a
   browser don't read each other's trail; 'anon' is signed-out. */
const recentPropsKey = () => 'dzRecentProps:' + (myMobile() || 'anon');
export const getRecentProps = () => read(recentPropsKey(), []);
export const pushRecentProp = (id) => {
  if (!id) return getRecentProps();
  const arr = getRecentProps().filter((x) => x !== id);
  arr.unshift(id);
  return write(recentPropsKey(), arr.slice(0, 8));
};

/* Dedupe by url, not label: one label with different filters is two
   distinct searches. Not a trust boundary, so no path allowlist. */
const recentSearchKey = () => 'dzRecentSearches:' + (myMobile() || 'anon');
export const getRecentSearches = () => read(recentSearchKey(), []);
export const pushRecentSearch = (rec) => {
  if (!rec || !rec.label || !rec.url) return getRecentSearches();
  const arr = getRecentSearches().filter((s) => s.url !== rec.url);
  arr.unshift({ label: rec.label, url: rec.url, at: Date.now() });
  return write(recentSearchKey(), arr.slice(0, 6));
};

/* sessionStorage survives a route change and refresh but not a new tab, matching the scope of return-to-search. */
const LAST_SEARCH_KEY = 'draazyLastSearch';
export const setLastSearch = (ctx) => {
  try { sessionStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(ctx)); } catch { /* ignore */ }
};
export const getLastSearch = () => {
  try { return JSON.parse(sessionStorage.getItem(LAST_SEARCH_KEY)); } catch { return null; }
};
