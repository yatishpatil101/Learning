import { seedPosition } from '../../../lib/listings/coords.js';

/* Stable per-listing map position.
   The position is now *stored* on the row — live listings carry `lat`/`lng` from the database, and
   the mock stamps the same pair onto seed rows at its read boundary (`lib/listings/coords.js`).
   This function used to compute one at render time instead, which put the pin somewhere the radius
   filter could not see: a proximity search asks the server, and the server cannot compare against a
   number the browser invented after the fact.
   The fallback below is for shapes that never went through a provider — a hand-built fixture, a
   half-populated draft — and it deliberately uses the same derivation the mock does, so the pin
   lands in the same place either way. */
export function propLatLng(p) {
  if (p && p.lat != null && p.lng != null) return [p.lat, p.lng];
  return seedPosition(p);
}
