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
   (budget, property type, localities, verification, near a place) is always
   relevant. `commercialType` keeps its own upstream condition. `room` (Private/
   Shared) is a flatmates-only concept. */
export function sectionVisible(section, types) {
  const g = typeGroups(types || new Set());
  if (section === 'landUse' || section === 'na') return g.size === 1 && g.has('land');
  if (section === 'room') return !!types && types.has('flatmates');
  if (section === 'food') return g.size === 1 && g.has('residential');
  if (section === 'shell' || section === 'preLeased') return g.size === 1 && g.has('commercial');
  if (!types || types.size === 0) return true; // browse-all
  const builtOrCommercial = g.has('residential') || g.has('commercial');
  const builtOnly = builtOrCommercial && !g.has('land');
  const residentialOnly = g.size === 1 && g.has('residential');
  switch (section) {
    case 'bhk':
    case 'facing':
    case 'baths':
    case 'tenants':
    // falls through — housing-society & society-conveyance checks only exist for residential homes.
    case 'verifSociety':
      return residentialOnly;
    case 'furnishing':
    case 'availability':
    case 'construction':
    case 'age':
    case 'floor':
    case 'amenities':
    case 'availFrom':
    // falls through — RERA registration covers residential & commercial projects, not raw land.
    case 'verifRera':
      return builtOnly;
    default:
      return true;
  }
}

/* Per-verification-option relevance. Options not listed here (Verified Owner,
   Ownership Verified) apply to every property type. */
export const VERIF_SECTIONS = { rera: 'verifRera', society: 'verifSociety', conveyance: 'verifSociety' };
