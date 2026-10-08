/* Shared by the Filters UI and results logic so a hidden filter can
   never silently narrow results; selecting nothing means browse all. */

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

/* Sections not listed are always relevant; `room` (Private/Shared) is a flatmates-only concept. */
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
export const VERIF_SECTIONS = { rera: 'verifRera' };
