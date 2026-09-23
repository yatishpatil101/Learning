import { localityBySlug } from '../../data/localities.js';
import { fnvHash } from '../hash.js';

/* FALLBACK ONLY, for shapes that never came from the API. Every `properties` row carries stored
   `lat`/`lng`, and a position invented in the browser is not one the server's radius filter can
   compare against. The offset is a function of the listing id, so a pin stays put while paging. */

/* Pune (Shivajinagar). Only reached by a listing whose locality is not in the registry, which the
   posting wizard does not allow — it exists so a hand-written fixture cannot produce `NaN`. */
const CITY_CENTRE = [18.5204, 73.8567];

/** ~0.0045 degrees is a little under 500 m at Pune's latitude. */
const SPREAD = 0.0045;

/** The stored position for a listing, or its locality-anchored stand-in. */
export function seedPosition(p) {
  const loc = localityBySlug(p?.localitySlug);
  const base = loc && loc.lat != null && loc.lng != null ? [loc.lat, loc.lng] : CITY_CENTRE;
  const h = fnvHash(p?.id || '');
  return [
    base[0] + (((h % 9) - 4) * SPREAD),
    base[1] + ((((h >> 8) % 9) - 4) * SPREAD),
  ];
}

/** Fills in `lat`/`lng` only when absent: a row that already carries coordinates always wins. */
export function withPosition(p) {
  if (!p) return p;
  if (p.lat != null && p.lng != null) return p;
  const [lat, lng] = seedPosition(p);
  return { ...p, lat, lng };
}

/** Great-circle distance in kilometres. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
