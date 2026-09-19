import { useEffect, useState } from 'react';
import { searchSocieties } from '../services/societyService.js';

/** Matches the 250 ms Admin ▸ Societies already debounces its directory search by. */
const DEBOUNCE_MS = 250;

/**
 * A hook, not a `useMemo`, because the catalogue now lives in Postgres: reading only the bundled rows made
 * societies other people added invisible, so the picker offered to mint a duplicate of an existing one.
 */
export function useSocietySearch(query, localityLabel = '', enabled = true) {
  const [rows, setRows] = useState([]);
  const [settledFor, setSettledFor] = useState(null);
  const key = `${query}\u0000${localityLabel}`;

  useEffect(() => {
    // An empty query is a legitimate one — it asks for the top of the catalogue — so "no text yet" cannot
    // double as "do not ask"; a picker mounted unconditionally but shut says so with `enabled`.
    if (!enabled) {
      setSettledFor(null);
      return undefined;
    }
    let alive = true;
    // Declared inside the effect rather than in a ref cleared on cleanup: under StrictMode the
    // mount/cleanup/re-mount cycle leaves such a ref stuck at false and swallows every result.
    const t = setTimeout(() => {
      searchSocieties(query, localityLabel)
        .then((next) => {
          if (!alive) return;
          setRows(Array.isArray(next) ? next : []);
          setSettledFor(key);
        })
        // Keep the last good list and stop claiming to be loading: a picker that never settles can never
        // offer its "Add this society" row, stranding the one user that row exists for.
        .catch(() => { if (alive) setSettledFor(key); });
    }, DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [key, query, localityLabel, enabled]);

  return { rows, loading: settledFor !== key };
}
