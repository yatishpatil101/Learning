import { seedPosition } from '../../../lib/listings/coords.js';

/* Stable per-listing map position.
   The position is *stored* on the row — listings carry `lat`/`lng` from the database. Computing one
   at render time instead puts the pin somewhere the radius filter cannot see: a proximity search
   asks the server, and the server cannot compare against a number the browser invented after the
   fact.
   The fallback below is for shapes that never went through a provider — a hand-built fixture, a
   half-populated draft. */
export function propLatLng(p) {
  if (p && p.lat != null && p.lng != null) return [p.lat, p.lng];
  return seedPosition(p);
}
