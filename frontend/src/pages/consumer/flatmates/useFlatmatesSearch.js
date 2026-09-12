import { useCallback, useEffect, useRef, useState } from 'react';
import { feed } from '../../../services/flatmateService.js';
import { isAbort } from '../../../services/http.js';
import { createSearchCache } from '../../../lib/searchCache.js';
import { TAB_MOVE_IN, TAB_TEAM_UP } from './model.js';

/* The board's one remote read. Why totals come off the response, why the cache is module scope and
   why refresh drops all of it: docs/system/frontend-data-seam.md § The board's one remote read. */

const EMPTY = { items: [], total: 0, verifiedTotal: 0, pageCount: 0 };

/* Shared across mounts because `GET /flatmates/feed` is a public read: its answer cannot depend
   on who is asking, and `me` only reorders it. */
const cache = createSearchCache({ max: 30, ttl: 60_000 });

/** Cache key for one request: everything that changes the answer, and nothing that does not. */
const cacheKey = (tab, filters, page, size) => JSON.stringify([tab, filters, page, size]);

const otherTab = (tab) => (tab === TAB_MOVE_IN ? TAB_TEAM_UP : TAB_MOVE_IN);

/**
 * Run a flatmates search: one page of the active tab, plus a count for the tab beside it.
 */
export default function useFlatmatesSearch({ tab = TAB_MOVE_IN, filters, page = 0, size = 24 }) {
  /* `loaded` means "answered at least once" and `status` cannot carry it: a tab count nobody has
     fetched yet must not render as `0`, which reads as "empty" at the one moment we do not know. */
  const [state, setState] = useState({
    data: EMPTY, otherCount: null, status: 'loading', error: null, loaded: false,
  });
  const [nonce, setNonce] = useState(0);

  /* In a ref so the effect need not depend on the filter object's identity — the board rebuilds it
     every render. The string key below changes when the *meaning* of the request changes. */
  const latest = useRef(filters);
  latest.current = filters;
  const key = JSON.stringify([tab, filters, page, size]);

  /* Refinements need not return in the order they were sent; without this the board shows whichever
     finished last, which is how a "verified only, women" board displays the unfiltered set. */
  const seq = useRef(0);

  /* "This re-run is a refresh, not a new search." `nonce` cannot say that: it is in the dependency
     list, so testing `nonce > 0` would make every search after the first bypass the cache. */
  const forceFresh = useRef(false);

  useEffect(() => {
    const f = latest.current;
    if (!f) return undefined;
    const mine = ++seq.current;
    const fresh = forceFresh.current;
    forceFresh.current = false;
    let live = true;
    /* The sequence guard above stops a late answer being *shown*; this stops it being *computed*,
       so the server is not left running a union and two counts for a set nobody will look at. */
    const ctl = new AbortController();
    // Not a blanking `setState` — the previous page stays on screen, marked stale, rather than the
    // board flashing skeletons between two nearly identical result sets.
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    const run = (wireTab, wirePage, wireSize) => cache.read(
      cacheKey(wireTab, f, wirePage, wireSize),
      (signal) => feed(wireTab, f, wirePage, wireSize, { signal }),
      { signal: ctl.signal, fresh },
    );

    (async () => {
      try {
        /* The inactive tab's count is not decoration: stock a seeker cannot see is stock they never
           switch tabs for. `allSettled` so a failed count leaves the badge absent, not invented. */
        const [primary, other] = await Promise.allSettled([
          run(tab, page, size),
          run(otherTab(tab), 0, 1),
        ]);
        if (primary.status === 'rejected') throw primary.reason;
        if (!live || mine !== seq.current) return;
        setState({
          data: primary.value,
          otherCount: other.status === 'fulfilled' ? other.value.total ?? null : null,
          status: 'ready',
          error: null,
          loaded: true,
        });
      } catch (err) {
        /* Tested *before* the sequence guard: an abort from an unmount arrives with `live` already
           false, so a guard in front of it would return early and this branch never run. */
        if (isAbort(err)) return;
        if (!live || mine !== seq.current) return;
        // Cleared rather than left standing: a stale board under an error banner reads as a live
        // result set that merely failed to update.
        setState({ data: EMPTY, otherCount: null, status: 'error', error: err, loaded: false });
      }
    })();

    return () => { live = false; ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the serialised request; the filter object itself is rebuilt every render.
  }, [key, tab, page, size, nonce]);

  /* Both doors mean "give me the current answer", so both skip the remembered one. The whole cache
     goes, not one key: a refresh follows a write, and a write invalidates unknowably much. */
  const rerun = useCallback(() => {
    forceFresh.current = true;
    cache.clear();
    setNonce((n) => n + 1);
  }, []);

  /* An owner's seat stepper must move with the tap, and the write is already accepted server-side.
     The patch is never written back to the cache — a cached page is the *server's* answer. */
  const patchItems = useCallback((updater) => {
    cache.clear();
    setState((prev) => ({ ...prev, data: { ...prev.data, items: updater(prev.data.items) } }));
  }, []);

  return {
    ...state.data,
    otherCount: state.otherCount,
    status: state.status,
    error: state.error,
    loaded: state.loaded,
    patchItems,
    retry: rerun,
    refresh: rerun,
  };
}
