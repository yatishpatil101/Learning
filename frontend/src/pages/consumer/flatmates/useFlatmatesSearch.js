import { useCallback, useEffect, useRef, useState } from 'react';
import { feed } from '../../../services/flatmateService.js';
import { isAbort } from '../../../services/http.js';
import { createSearchCache } from '../../../lib/searchCache.js';
import { TAB_MOVE_IN } from './model.js';

const EMPTY = { items: [], total: 0, verifiedTotal: 0, pageCount: 0 };

/* Shared across mounts because `GET /flatmates/feed` is a public read: its answer cannot depend
 * on who is asking, and `me` only reorders it. */
const cache = createSearchCache({ max: 30, ttl: 60_000 });

const cacheKey = (tab, filters, page, size) => JSON.stringify([tab, filters, page, size]);

export default function useFlatmatesSearch({ tab = TAB_MOVE_IN, filters, page = 0, size = 24 }) {
  /* `loaded` means "answered at least once" and `status` cannot carry it: a tab count nobody has fetched yet must not
     render as `0`, which reads as "empty" at the one moment we do not know. */
  const [state, setState] = useState({
    data: EMPTY, tab, otherCount: null, status: 'loading', error: null, loaded: false,
  });
  const [nonce, setNonce] = useState(0);

  const latest = useRef(filters);
  latest.current = filters;
  const key = JSON.stringify([tab, filters, page, size]);

  /* Refinements need not return in the order they were sent; without this the board shows whichever finished last,
     which is how a "verified only, women" board displays the unfiltered set. */
  const seq = useRef(0);

  const forceFresh = useRef(false);

  useEffect(() => {
    const f = latest.current;
    if (!f) return undefined;
    const mine = ++seq.current;
    const fresh = forceFresh.current;
    forceFresh.current = false;
    let live = true;
    /* The sequence guard above stops a late answer being *shown*; this stops it being *computed*, so the server is
       not left running a union and two counts for a set nobody will look at. */
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
        /* The response also carries the inactive tab's count. It is not decoration: stock a seeker
         * cannot see is stock they never switch tabs for. */
        const primary = await run(tab, page, size);
        if (!live || mine !== seq.current) return;
        setState({
          data: primary,
          tab,
          otherCount: primary.otherTabTotal ?? null,
          status: 'ready',
          error: null,
          loaded: true,
        });
      } catch (err) {
        /* Tested *before* the sequence guard: an abort from an unmount arrives with `live` already false, so a guard
           in front of it would return early and this branch never run. */
        if (isAbort(err)) return;
        if (!live || mine !== seq.current) return;
        // Cleared rather than left standing: a stale board under an error banner reads as a live
        // result set that merely failed to update.
        setState({ data: EMPTY, tab, otherCount: null, status: 'error', error: err, loaded: false });
      }
    })();

    return () => { live = false; ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the.
  }, [key, tab, page, size, nonce]);

  const rerun = useCallback(() => {
    forceFresh.current = true;
    cache.clear();
    setNonce((n) => n + 1);
  }, []);

  const sameTab = state.tab === tab;
  const data = sameTab ? state.data : EMPTY;

  return {
    ...data,
    otherCount: sameTab ? state.otherCount : null,
    status: sameTab ? state.status : 'loading',
    error: state.error,
    loaded: sameTab && state.loaded,
    retry: rerun,
    refresh: rerun,
  };
}
