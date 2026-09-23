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
/* The widest radius the product offers. The server clamps at 50 km (`ListingFacets.MAX_RADIUS_KM`),
   which is a backstop against a hand-edited URL rather than a second opinion about the UI: past a
   city's own width "near this place" stops meaning anything. Clamp every radius that arrives from
   outside the controls to this, or a shared `?nearr=9999` shows a chip the search never honoured. */
export const NEAR_MAX_RADIUS = 25;
/* The widest commute the product offers, in MINUTES. Equal to `NEAR_MAX_RADIUS` today by
   coincidence, not by definition — the two axes measure different quantities (`nearParams` walks
   minutes at 0.4 km/min), so widening the distance cap must not silently widen the commute one. */
export const NEAR_MAX_MINUTES = 25;

/** The ceiling that applies to the axis `mode` selects. */
export const nearMaxFor = (mode) => (mode === 'min' ? NEAR_MAX_MINUTES : NEAR_MAX_RADIUS);

/** The nearest offered radius to `raw`, for input handlers and for URLs written by someone else. */
export const clampNearRadius = (raw, max = NEAR_MAX_RADIUS) =>
  Math.min(max, Math.max(1, Math.round(Number(raw)) || 1));

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
