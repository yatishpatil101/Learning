/* Single source of truth for the "Near a Place" URL contract.
   Both entry points — the homepage hero (via searchEntities.paramsFromTokens) and
   the Listings filter panel (via filterState.filtersToParams) — build the same
   near params through this helper so the two paths can never drift apart again.

   Contract (only non-defaults are written, keeping the address bar clean):
     near      = "lat,lng"        (required; the proximity point)
     nearlabel = human name       (so a POI shows its name, not raw coords)
     nearr     = radius           (omitted when the default 5)
     nearmode  = "min"            (omitted when "km", the default)

   Deliberately carries NO locality: a proximity point is scoped by its radius, not
   by an exact-slug AND. Emitting a parent locality here is what made a gated landmark
   dead-end when its slug held no stock but nearby slugs did. */
export const NEAR_DEFAULT_RADIUS = 5;
export const NEAR_DEFAULT_MODE = 'km';

export function nearToParams({ near, nearLabel = '', radius = NEAR_DEFAULT_RADIUS, mode = NEAR_DEFAULT_MODE } = {}) {
  const p = {};
  if (!near) return p;
  // Guard against a malformed point round-tripping from a shared/edited URL.
  const parts = String(near).split(',');
  if (parts.length !== 2 || Number.isNaN(Number(parts[0])) || Number.isNaN(Number(parts[1]))) return p;
  p.near = near;
  if (nearLabel) p.nearlabel = nearLabel;
  if (typeof radius === 'number' && radius !== NEAR_DEFAULT_RADIUS) p.nearr = String(radius);
  if (mode && mode !== NEAR_DEFAULT_MODE) p.nearmode = mode;
  return p;
}
