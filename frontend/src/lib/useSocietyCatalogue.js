import { useEffect, useState } from 'react';
import { ensureSocietyCatalogue, societyCatalogueLoaded } from '../data/societies.js';

/**
 * Render gate for the MahaRERA half of the society catalogue: true once every society accessor
 * answers completely. A completeness gate, not a loading gate — docs/system/cross-cutting.md.
 */
export function useSocietyCatalogue() {
  const [ready, setReady] = useState(societyCatalogueLoaded);
  useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    ensureSocietyCatalogue()
      .then(() => { if (alive) setReady(true); })
      // Stay false and do not rethrow: the next read retries, and resolving `true` would tell a
      // surface its partial 28-row view is the complete catalogue.
      .catch(() => {});
    return () => { alive = false; };
  }, [ready]);
  return ready;
}
