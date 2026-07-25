/* Deterministic hash functions for stable per-listing derivations.
   Two variants exist — DO NOT change the algorithm without updating all consumers,
   as derived attributes (facing, floor, age) would shift for existing data. */

/** FNV-1a hash — used by Listings enrichment and filter seeding. */
export function fnvHash(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** djb2 hash — used by Property detail page derivations. */
export function djb2Hash(id) {
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
