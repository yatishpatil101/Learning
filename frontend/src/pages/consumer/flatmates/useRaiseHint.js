import { useEffect, useState } from 'react';
import { feed } from '../../../services/flatmateService.js';
import { isAbort } from '../../../services/http.js';
import { BUDGET_MAX, perHead } from './helpers.js';
import { decorateRooms, bestPerPersonRent } from './model.js';

/* An empty board must say what would fix it, and the answer cannot be a client-side scan: the
   current search returned nothing, which is the whole situation. So: ask again, budget dropped. */

/** The upper bound to suggest: the cheapest match, rounded up to a round thousand. */
const suggestion = (price) => Math.min(BUDGET_MAX, Math.ceil(price / 1000) * 1000);

/* A room is quoted at its best achievable per-person price — the number the filter matched on —
   so the hint cannot name a price the search never used. */
const priceOf = (row) => {
  if (!row) return null;
  if (row.kind === 'group') return perHead(row);
  if (row.kind === 'room') return bestPerPersonRent(decorateRooms([row])[0]);
  return row.budget ?? null;
};

/**
 * @returns {{price: number, budget: number}|null}
 */
export default function useRaiseHint({ tab, filters, query, empty }) {
  const [hint, setHint] = useState(null);

  const ceiling = filters?.budget?.[1];
  /* Specifically the CEILING: a seeker who only lifted the floor has nothing to raise, and the
     guard below would reject every answer because no price can exceed the top of the scale. */
  const narrowed = ceiling != null && ceiling < BUDGET_MAX;
  // `ceiling` is read in the callback, so it belongs in the key.
  const key = JSON.stringify([tab, query, empty, ceiling]);

  useEffect(() => {
    if (!empty || !narrowed) { setHint(null); return undefined; }
    let live = true;
    const ctl = new AbortController();
    /* Budget removed rather than widened to the slider's ends: the cheapest match sitting above
       the scale is exactly the case where a hint is most useful. */
    const widened = { ...query, budget: undefined, sort: 'budget-low', me: undefined };
    feed(tab, widened, 0, 1, { signal: ctl.signal })
      .then((res) => {
        if (!live) return;
        const price = priceOf(res.items?.[0]);
        // Only a ceiling can be raised: if the cheapest match sits under the seeker's floor the
        // fix is a different sentence, so say nothing rather than offer a change that won't help.
        if (price == null || !(price > ceiling)) { setHint(null); return; }
        setHint({ price, budget: suggestion(price) });
      })
      .catch((err) => {
        if (isAbort(err) || !live) return;
        // A failed hint is not a failed search: the board behind it is fine, and this card simply
        // does not appear, which is what it does for most searches anyway.
        setHint(null);
        if (import.meta.env?.DEV) console.warn('[flatmates] raise-budget hint failed', err);
      });
    return () => { live = false; ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the serialised question.
  }, [key]);

  return hint;
}
