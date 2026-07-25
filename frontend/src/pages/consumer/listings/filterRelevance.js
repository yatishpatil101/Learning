/* ---------- property-type-aware filter relevance ----------
   Single source of truth for WHICH filter sections are meaningful given the
   Property Type(s) the user has selected. Used by both the Filters UI (to render
   only relevant groups) and the Listings results/chips logic (so a filter that is
   hidden can never silently narrow results). Selecting nothing means "browse all"
   → every section is shown.

   The eight canonical property-type keys collapse into three groups that actually
   differ in what a buyer/tenant needs to see:
     residential — flat, house, villa, pg, flatmates
     commercial  — commercial
     land        — plot (legacy), openplot, farmland                              */

const RESIDENTIAL = new Set(['flat', 'house', 'villa', 'pg', 'flatmates']);
const LAND = new Set(['plot', 'openplot', 'farmland']);

export function typeGroups(types) {
  const g = new Set();
  types.forEach((t) => {
    if (RESIDENTIAL.has(t)) g.add('residential');
    else if (t === 'commercial') g.add('commercial');
    else if (LAND.has(t)) g.add('land');
  });
  return g;
}

/* Sections whose relevance depends on the selected type. Anything not listed here
   (budget, property type, localities, area, verification, near a place) is always
   relevant. `commercialType` keeps its own upstream condition. `room` (Private/
   Shared) is a flatmates-only concept; `sharing` (occupancy) is PG/Hostel-only. */
export function sectionVisible(section, types) {
  const g = typeGroups(types || new Set());
  // Land Use is a land-only filter: gate it on the land group even in browse-all,
  // so a stale zone selection can never apply to (or hide) non-land listings.
  if (section === 'landUse') return g.has('land');
  // Sharing (PG occupancy) is meaningful only when PG/Hostel is in the selection,
  // even in browse-all — so a stale sharing pick can't narrow non-PG results.
  if (section === 'sharing') return !!types && types.has('pg');
  if (section === 'room') return !!types && types.has('flatmates');
  if (!types || types.size === 0) return true; // browse-all
  const builtOrCommercial = g.has('residential') || g.has('commercial');
  switch (section) {
    case 'bhk':
      // BHK is meaningless for a PG (defined by occupancy/Sharing). Hide it when
      // PG is the only residential type chosen, but keep it when a BHK-based home
      // (flat/house/villa/flatmates) is also selected.
      return [...types].some((t) => RESIDENTIAL.has(t) && t !== 'pg');
    case 'tenants':
    // falls through — housing-society & society-conveyance checks only exist for residential homes.
    case 'verifSociety':
      return g.has('residential');
    case 'furnishing':
    case 'availability':
    case 'construction':
    case 'age':
    case 'floor':
    case 'amenities':
    case 'availFrom':
    // falls through — RERA registration covers residential & commercial projects, not raw land.
    case 'verifRera':
      return builtOrCommercial;
    default:
      return true;
  }
}

/* Per-verification-option relevance. Options not listed here (Verified Owner,
   Ownership Verified) apply to every property type. */
export const VERIF_SECTIONS = { rera: 'verifRera', society: 'verifSociety', conveyance: 'verifSociety' };
