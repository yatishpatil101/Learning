import { useCallback, useEffect, useRef, useState } from 'react';
import { searchListings } from '../../../services/propertyService.js';

/* ---------- the listings page's one remote read ----------
   The page used to fetch the first 100 listings once and do everything else in the browser: ~25
   filter axes, the relevance ranking, and the paging. That is a different product from the one it
   appeared to be. Every filter really meant "of the first 100", the result count and the "N
   verified" beside it described a page while reading as facts about the catalogue, and page 12 of a
   Baner search was unreachable because the catalogue was cut off long before Baner ran out.

   So a page of results is now a request, and the totals come off the response — they are the two
   numbers that cannot be recovered from a page and the reason the endpoint returns them. */

const EMPTY = { items: [], total: 0, verifiedTotal: 0, pageCount: 0 };

/**
 * Run a listings search, with the near-search recovery and the races a paged remote read implies.
 *
 * @param {object|null} opts.query         wire query from `toFacetQuery`; null suspends the read.
 * @param {object|null} opts.relaxedQuery  the same query without the locality filter, used only
 *   when the primary comes back empty. Null disables the recovery.
 * @param {number} opts.page  1-based.
 * @param {number} opts.size  rows per page — the grid and the map want very different numbers.
 * @returns {{data: object, status: 'loading'|'ready'|'error', error: Error|null, relaxed: boolean,
 *   retry: () => void, refresh: () => void}}
 */
export default function useListingsSearch({ query, relaxedQuery = null, page = 1, size = 24 }) {
  const [state, setState] = useState({ data: EMPTY, status: 'loading', error: null, relaxed: false });
  const [nonce, setNonce] = useState(0);

  /* Held in a ref so the effect can read the current queries without depending on their object
     identity — both are rebuilt every render, and depending on them directly would re-fetch on
     every keystroke that changes nothing about the search. The string key below is the real
     dependency: it changes when the *meaning* of the request changes, not when its object does. */
  const latest = useRef({ query, relaxedQuery });
  latest.current = { query, relaxedQuery };
  const key = JSON.stringify([query, relaxedQuery, page, size]);

  /* A search is a sequence of requests over one screen, and they do not have to come back in the
     order they were sent — a broad query typed through on the way to a narrow one can easily
     outlive it. Without this, the results shown are whichever request the network finished last,
     which is how a filtered page ends up displaying unfiltered listings. Only the most recent
     request may write state; the rest are discarded on arrival. */
  const seq = useRef(0);

  useEffect(() => {
    const { query: q, relaxedQuery: relaxQ } = latest.current;
    if (!q) return undefined;
    const mine = ++seq.current;
    let live = true;
    // Not `setState({ status: 'loading' })` — that would blank the results on every refinement and
    // make the page flash skeletons between two nearly identical result sets. The previous page
    // stays on screen, marked stale, until the new one arrives.
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    (async () => {
      try {
        const primary = await searchListings(q, { page, size });
        // Recovery: a map pin and a locality selection can contradict each other outright, and the
        // honest-but-useless answer is an empty page. Drop the tighter of the two — the localities,
        // since the pin is the more specific intent — and say so. Deliberately only on a genuinely
        // empty primary, so an ordinary search is never quietly widened underneath the user.
        if (primary.total === 0 && relaxQ) {
          const relaxed = await searchListings(relaxQ, { page: 1, size });
          if (!live || mine !== seq.current) return;
          if (relaxed.total > 0) {
            setState({ data: relaxed, status: 'ready', error: null, relaxed: true });
            return;
          }
        }
        if (!live || mine !== seq.current) return;
        setState({ data: primary, status: 'ready', error: null, relaxed: false });
      } catch (err) {
        if (!live || mine !== seq.current) return;
        // The results are cleared on failure rather than left standing. A stale page under an error
        // banner reads as a live result set that merely failed to update, and the filters beside it
        // would describe a search these listings never came from.
        setState({ data: EMPTY, status: 'error', error: err, relaxed: false });
      }
    })();

    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the serialised query; the objects themselves are rebuilt every render.
  }, [key, page, size, nonce]);

  const rerun = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry: rerun, refresh: rerun };
}
