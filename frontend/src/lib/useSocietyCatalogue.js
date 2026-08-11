import { useEffect, useState } from 'react';
import { ensureSocietyCatalogue, societyCatalogueLoaded } from '../data/societies.js';

/**
 * Render gate for the MahaRERA half of the society catalogue (D129).
 *
 * `data/societies.js` splits its 182 KB bulk import behind `import()`, so every
 * synchronous accessor there (`allSocieties`, `societyBySlug`, `searchSocieties`
 * via the store) answers with the 28 curated rows until that chunk lands. That
 * is the right default for a surface that only wants *a* society quickly, and
 * the wrong one for a surface that claims to be showing the catalogue: without
 * a re-render it paints 28 of 348 and never corrects itself.
 *
 * So a caller that makes that claim reads this hook and puts the returned flag
 * in the dependency list of whatever memo reads the catalogue. The first render
 * still paints immediately from the curated rows — this is a completeness gate,
 * not a loading gate, and adding a spinner would trade a fast partial answer for
 * a slow empty one.
 *
 * WHAT THIS HOOK DOES NOT COST. It does not decide whether the chunk is fetched.
 * `catalogue()` in data/societies.js calls `ensureSocietyCatalogue()` on every
 * read, so the *first* accessor touched on a route starts the download whether or
 * not anything gated it — including on Home, via `SocietiesSection`. Calling this
 * hook adds one re-render and zero bytes. (An earlier version of this docblock
 * claimed gating a Home surface "would fetch the bulk rows on the entry route
 * again"; that was simply wrong, and it was being cited to justify leaving real
 * correctness bugs unfixed. Getting Home byte-free is a separate job: those call
 * sites would have to stop reading the full catalogue at all.)
 *
 * @returns {boolean} true once every society accessor answers completely
 */
export function useSocietyCatalogue() {
  const [ready, setReady] = useState(societyCatalogueLoaded);
  useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    ensureSocietyCatalogue()
      .then(() => { if (alive) setReady(true); })
      // Stay false and do not rethrow. `ensureSocietyCatalogue` has already dropped its
      // cached promise, so the next mount or the next accessor retries; what must not
      // happen is this resolving to `true` on a failure, which would tell a surface its
      // partial 28-row view is the complete catalogue.
      .catch(() => {});
    return () => { alive = false; };
  }, [ready]);
  return ready;
}
