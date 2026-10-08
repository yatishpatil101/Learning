import { fnvHash } from '../hash.js';

/* Fallback only: the server's radius filter can't compare a browser-invented
   position. The offset is id-based so a pin stays put while paging. */

/* Pune (Shivajinagar). Only reached by a row with no stored pin, so a hand-written fixture cannot
   produce `NaN`. */
const CITY_CENTRE = [18.5204, 73.8567];

/** ~0.0045 degrees is a little under 500 m at Pune's latitude. */
const SPREAD = 0.0045;

/** The stored position for a listing, or a stand-in near the city centre. */
export function seedPosition(p) {
  const h = fnvHash(p?.id || '');
  return [
    CITY_CENTRE[0] + (((h % 9) - 4) * SPREAD),
    CITY_CENTRE[1] + ((((h >> 8) % 9) - 4) * SPREAD),
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
