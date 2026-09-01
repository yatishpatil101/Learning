import { readUser } from '../auth.js';
import { myMobile } from '../contact.js';
import { get, set } from './internals.js';

/* Device appearance preferences moved to `lib/localPrefs.js`. They never belonged here: this module
   stands in for server tables until each one is wired up, and `reduceMotion` has no server table to
   wait for — it is a fact about one screen, set before anyone signs in. */

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
  // `pnAppPrefs` carries no suffix, so the `:mob` test already excludes it along with every other
  // device-level key. Named here only because the comment above promises it.
  return owned && k.endsWith(':' + mob);
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

/* `deleteMyData` lived here and wiped this browser's keys when the settings screen said "Delete
   forever". It is gone because it was never what the product does: erasure is a request the server
   reviews (`POST /me/erasure`), since an account can be the counterparty on a live tenancy or a
   settled payment that is not ours alone to remove. Clearing local storage made the data *look*
   gone on one device while every record survived, which is the worst of both answers. The settings
   screen now files the request and says so. */

