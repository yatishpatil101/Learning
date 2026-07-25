/* Central prototype data-store (localStorage). Ports the static app's `Auth`
   object (auth.js) transactional/business-logic layer into the React app,
   reusing the SAME storage keys so data stays compatible across both prototypes.

   Covers: deals + "Under Offer", maker-checker finalization, in-app offers,
   tenancies, rent payments / ledger / mandate, entity reviews, referrals,
   saved searches, plans + boosts, service orders, property visit requests,
   verification review threads, payout accounts, platform fees.

   Prototype only — NOT real security. */

import { persistSave, persistLoad } from '../persist.js';

export const get = (k, def) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v == null ? def : v;
  } catch {
    return def;
  }
};
export const set = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    // Also persist to disk (debounced, dev-only) — aggregated under "userdata" key
    _scheduleUserDataPersist();
    // Notify in-page listeners (e.g. navbar badges) so counts refresh live without
    // a route change. The native `storage` event only fires cross-tab, so we emit
    // our own same-tab signal.
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pn:store', { detail: { key: k } }));
  } catch {
    /* quota */
  }
  return v;
};

/**
 * Aggregate all user-scoped localStorage keys into a single JSON file on disk.
 * Debounced — only writes once after 1.2s of inactivity (many mutations happen in bursts).
 */
let _persistTimer = null;
export function _scheduleUserDataPersist() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    const snapshot = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // Persist all PuneNest user-scoped keys (skip the main DB — that's handled
      // by mockApi — and transient form drafts, which own their own lifecycle via
      // useFormDraft/localStorage and must not survive a "Start over" reset).
      if (k && k !== 'puneNestDB_v1' && !k.startsWith('pnDraft:') && (k.startsWith('puneNest') || k.startsWith('pn'))) {
        try { snapshot[k] = JSON.parse(localStorage.getItem(k)); } catch { /* skip */ }
      }
    }
    persistSave('userdata', snapshot);
  }, 1200);
}

// On startup, try to hydrate user data from persisted file
(async () => {
  const fileData = await persistLoad('userdata');
  if (!fileData || typeof fileData !== 'object') return;
  // Only restore keys that don't already exist in localStorage. Transient form
  // drafts (pnDraft:*) are intentionally excluded — they belong to the current
  // browser session only, so a stale disk copy never resurrects cleared data.
  for (const [k, v] of Object.entries(fileData)) {
    if (k.startsWith('pnDraft:')) continue;
    if (!localStorage.getItem(k)) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
    }
  }
})();

/* ---- Parse a price/amount string ("₹25,000/mo") into an integer ---- */
export const parseAmount = (s) => parseInt(String(s == null ? '' : s).replace(/[^\d]/g, ''), 10) || 0;

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
export const clearLastSearch = () => {
  try { sessionStorage.removeItem(LAST_SEARCH_KEY); } catch { /* ignore */ }
};
