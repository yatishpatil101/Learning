import { fnvHash as hashId } from '../../../lib/hash.js';
import { LOC_COORDS } from './constants.js';

/* Stable per-listing map position.
   Positions are anchored at the locality's real coordinates and spread by a
   deterministic offset derived from the listing id — NOT its index in the current
   result set. This keeps a marker fixed to the same spot regardless of filtering,
   sorting or paging (an index-based offset made pins jump around as the list changed).
   Explicit `lat`/`lng` (real owner-posted data / seeded stock) always win. */

const DEFAULT = [18.553, 73.86];

export function propLatLng(p) {
  if (p && p.lat != null && p.lng != null) return [p.lat, p.lng];
  const base = LOC_COORDS[p?.localitySlug] || DEFAULT;
  const h = hashId(p?.id || '');
  const dLat = (((h % 9) - 4) * 0.0045);
  const dLng = ((((h >> 8) % 9) - 4) * 0.0045);
  return [base[0] + dLat, base[1] + dLng];
}
