import { readUser } from '../auth.js';
import { digits, myMobile } from '../contact.js';
import { get, set } from './internals.js';

/* =========================================================================
   Device/app appearance preferences (NOT user-scoped — applies before login).
   `reduceMotion` toggles a root class that disables scroll/hover animations.
   ========================================================================= */
const APP_PREF_KEY = 'pnAppPrefs';
export const getAppPrefs = () => ({ reduceMotion: false, ...(get(APP_PREF_KEY, {}) || {}) });
export const setAppPrefs = (patch) => {
  const next = { ...getAppPrefs(), ...patch };
  set(APP_PREF_KEY, next);
  applyAppPrefs(next);
  return next;
};
// Reflect appearance prefs onto <html> so CSS can react. Safe to call repeatedly.
export const applyAppPrefs = (prefs = getAppPrefs()) => {
  if (typeof document === 'undefined') return prefs;
  document.documentElement.classList.toggle('pn-reduce-motion', !!prefs.reduceMotion);
  return prefs;
};

/* =========================================================================
   Data & account controls (DPDP-style self-serve). Export gathers every
   PuneNest key that belongs to the signed-in user; delete wipes them and the
   account registry entry (the caller clears the session via AuthContext).
   ========================================================================= */
// Keys that are scoped to the current user — suffixed with their own mobile. We
// deliberately EXCLUDE `:anon` keys: those belong to signed-out sessions on this
// device and are not this account's to export or erase. The device-level
// appearance pref is left intact too.
const isMyDataKey = (k, mob) => {
  if (!k || !mob) return false;
  const owned = k.startsWith('pn') || k.startsWith('puneNest');
  return owned && k.endsWith(':' + mob) && k !== APP_PREF_KEY;
};
export const exportUserData = () => {
  const mob = myMobile();
  const snapshot = { exportedAt: new Date().toISOString(), user: readUser() || null, data: {} };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (isMyDataKey(k, mob)) {
      try { snapshot.data[k] = JSON.parse(localStorage.getItem(k)); } catch { /* skip */ }
    }
  }
  return snapshot;
};
export const deleteMyData = () => {
  const mob = myMobile();
  const doomed = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (isMyDataKey(k, mob)) doomed.push(k);
  }
  doomed.forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  // Remove the account from the sign-up registry so the number reads as new again.
  try {
    const users = JSON.parse(localStorage.getItem('puneNestUsers')) || [];
    const next = users.filter((u) => digits(u.mobile) !== mob);
    localStorage.setItem('puneNestUsers', JSON.stringify(next));
  } catch { /* ignore */ }
  return doomed.length;
};

