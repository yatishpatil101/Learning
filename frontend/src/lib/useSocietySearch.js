import { useEffect, useState } from 'react';
import { searchSocieties } from '../services/societyService.js';

/**
 * Ranked society type-ahead, for pickers.
 *
 * ## Why this is a hook and not a `useMemo`
 *
 * Every caller used to hold `useMemo(() => searchSocieties(q, loc), [q, loc, catalogueReady])`,
 * where `searchSocieties` was a synchronous reduce over the bundled 348 rows plus this browser's
 * community additions. Live that is the wrong catalogue: societies added by other people are in
 * Postgres and are simply invisible, so the picker's "Add '<name>'" row offers to mint a society
 * that already exists — the exact duplicate this control exists to prevent. The read is now
 * `GET /societies?q=`, which is asynchronous, and a memo cannot hold an asynchronous answer.
 *
 * ## The previous results stay on screen while a new query is in flight
 *
 * `rows` is never cleared on a keystroke. A picker that blanked between keystrokes would flicker
 * its list on every character and, worse, would briefly show no exact match — which is what
 * `canCreate` reads to decide whether to offer a mint. Holding the stale list is the safer of the
 * two wrong answers for the instant it is wrong.
 *
 * ## Staleness
 *
 * A per-effect `alive` flag, the same way `useSocietyCatalogue` does it, so a query superseded
 * mid-flight cannot overwrite a newer one. Deliberately declared *inside* the effect rather than
 * held in a `useRef` cleared in cleanup: under StrictMode the mount/cleanup/re-mount cycle leaves
 * such a ref stuck at false for the life of the component, silently swallowing every result it
 * ever gets.
 *
 * @param {string} query the text typed so far
 * @param {string} [localityLabel] the locality to prefer — a ranking hint, never a filter
 * @param {boolean} [enabled] set false when the picker is closed. Needed because an empty query is
 *   a legitimate one — it asks for the top of the catalogue, which is what a picker shows before
 *   the first keystroke — so "no text yet" cannot double as "do not ask". Admin ▸ Societies mounts
 *   its merge dialog's hook unconditionally (rules of hooks) and would otherwise pull sixty
 *   societies over the wire on every visit to a screen where the dialog is shut.
 * @returns {{rows: Array<{id: string, slug: string, name: string, localitySlug: string,
 *   builder: string, verified: boolean, community: boolean}>, loading: boolean}} `loading` is true
 *   only while the very first read is outstanding, so a caller can tell "no matches" from "not
 *   asked yet".
 */
export function useSocietySearch(query, localityLabel = '', enabled = true) {
  const [rows, setRows] = useState([]);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    searchSocieties(query, localityLabel)
      .then((next) => {
        if (!alive) return;
        setRows(Array.isArray(next) ? next : []);
        setSettled(true);
      })
      // Keep the last good list and stop claiming to be loading. A picker that never settles can
      // never offer its "Add this society" row, which would strand a user whose building genuinely
      // is not in the catalogue — the one case the row exists for.
      .catch(() => { if (alive) setSettled(true); });
    return () => { alive = false; };
  }, [query, localityLabel, enabled]);

  return { rows, loading: !settled };
}
