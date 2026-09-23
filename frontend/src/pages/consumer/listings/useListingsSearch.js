import { useCallback, useEffect, useRef, useState } from 'react';
import { searchListings } from '../../../services/propertyService.js';
import { isAbort } from '../../../services/http.js';
import { createSearchCache } from '../../../lib/searchCache.js';

/* The listings page's one remote read. A page of results is a REQUEST and the totals come off the
   response — see `docs/system/frontend-data-seam.md` § The listings search slice. */

const EMPTY = { items: [], total: 0, verifiedTotal: 0, unstatedTotal: 0, pageCount: 0 };

/* Module scope so the cache outlives a remount (Back from a property, the grid↔map toggle). Safe to
   share: `GET /properties` is public and floored to approved rows, so the answer is caller-agnostic. */
const cache = createSearchCache({ max: 30, ttl: 60_000 });

/** Cache key for one request: everything that changes the answer, and nothing that does not. */
const cacheKey = (query, page, size) => JSON.stringify([query, page, size]);

/** `query` null suspends the read; `relaxedQuery` (minus localities) is used only when the
 *  primary search comes back empty. */
export default function useListingsSearch({ query, relaxedQuery = null, page = 1, size = 24 }) {
  const [state, setState] = useState({ data: EMPTY, status: 'loading', error: null, relaxed: false });
  const [nonce, setNonce] = useState(0);

  /* In a ref so the effect does not depend on object identity: both queries are rebuilt every
     render. `key` below is the real dependency — it changes when the request's *meaning* does. */
  const latest = useRef({ query, relaxedQuery });
  latest.current = { query, relaxedQuery };
  const key = JSON.stringify([query, relaxedQuery, page, size]);

  /* Responses need not arrive in the order they were sent, so only the newest may write state —
     without this a filtered page can end up displaying unfiltered listings. */
  const seq = useRef(0);

  /* "This re-run is a refresh, not a new search." `nonce` cannot say that: it is a dependency, so
     testing `nonce > 0` would make every search after the first bypass the cache. */
  const forceFresh = useRef(false);

  useEffect(() => {
    const { query: q, relaxedQuery: relaxQ } = latest.current;
    if (!q) return undefined;
    const mine = ++seq.current;
    const fresh = forceFresh.current;
    forceFresh.current = false;
    let live = true;
    /* The sequence guard stops a late answer being *shown*; this stops it being *computed*, so the
       server is not left running a page query and two counts for a set nobody will see. */
    const ctl = new AbortController();
    // Keeps the previous page on screen marked stale: a full `loading` state would flash skeletons
    // between two nearly identical result sets on every refinement.
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    const run = (wire, wirePage) => cache.read(
      cacheKey(wire, wirePage, size),
      (signal) => searchListings(wire, { page: wirePage, size, signal }),
      { signal: ctl.signal, fresh },
    );

    (async () => {
      try {
        const primary = await run(q, page);
        // A map pin and a locality selection can contradict outright. Drop the localities — the pin
        // is the more specific intent — but only on a genuinely empty primary, and say so.
        if (primary.total === 0 && relaxQ) {
          const relaxed = await run(relaxQ, 1);
          if (!live || mine !== seq.current) return;
          if (relaxed.total > 0) {
            setState({ data: relaxed, status: 'ready', error: null, relaxed: true });
            return;
          }
        }
        if (!live || mine !== seq.current) return;
        setState({ data: primary, status: 'ready', error: null, relaxed: false });
      } catch (err) {
        /* Tested BEFORE the sequence guard: an abort from an unmount arrives with `live` already
           false, so a guard in front of it would return early and never reach this branch. */
        if (isAbort(err)) return;
        if (!live || mine !== seq.current) return;
        // A stale page under an error banner reads as a live result set that merely failed to
        // update, and the filters beside it would describe a search it never came from.
        setState({ data: EMPTY, status: 'error', error: err, relaxed: false });
      }
    })();

    return () => { live = false; ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the serialised query; the objects themselves are rebuilt every render.
  }, [key, page, size, nonce]);

  /* Both doors are an explicit "give me the current answer", so both skip the remembered value —
     only that value, so two refreshes at once are still deduped into one request. */
  const rerun = useCallback(() => {
    forceFresh.current = true;
    setNonce((n) => n + 1);
  }, []);
  return { ...state, retry: rerun, refresh: rerun };
}
