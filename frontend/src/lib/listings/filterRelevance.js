/* Single source of truth for WHICH filter sections are meaningful for the selected property types —
   read by the Filters UI and by the results/chips logic, so a hidden filter can never silently
   narrow results. Selecting nothing means "browse all". The canonical type keys collapse into the
   three groups that actually differ in what a buyer needs to see: residential, commercial, land. */

const RESIDENTIAL = new Set(['flat', 'house', 'villa', 'flatmates']);
const LAND = new Set(['plot', 'farmland']);

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
   Shared) is a flatmates-only concept. */
export function sectionVisible(section, types) {
  const g = typeGroups(types || new Set());
  // Land Use is a land-only filter: gate it on the land group even in browse-all,
  // so a stale zone selection can never apply to (or hide) non-land listings.
  if (section === 'landUse') return g.has('land');
  if (section === 'room') return !!types && types.has('flatmates');
  if (!types || types.size === 0) return true; // browse-all
  const builtOrCommercial = g.has('residential') || g.has('commercial');
  switch (section) {
    case 'bhk':
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
