import { localityBySlug } from '../../data/localities.js';
import { fnvHash } from '../hash.js';

/**
 * Where a listing sits on the map — as **stored data**, never as a display-time guess.
 *
 * Every row in the live `properties` table carries `lat`/`lng`; the seed catalogue in mock mode did
 * not, and the page papered over that by computing a pin position at render time. Two things went
 * wrong with that. The map drew a marker at a spot the listing had never claimed, and — worse once
 * search moved server-side — the "Near a Place" radius filter had nothing to filter on, because a
 * position invented in the browser is not a position the server can compare against. A radius
 * search that quietly matches on a hash of the id is not a radius search.
 *
 * So the derivation happens **once**, at the mock's read boundary, and what comes out is an
 * ordinary `lat`/`lng` on the row — the same shape the API returns. After that the map, the filter
 * and the distance label are all reading one number and cannot disagree.
 *
 * The offset is a function of the listing id, not of its position in the current result set, so a
 * pin stays put as the user filters, sorts and pages. It is bounded to roughly ±400 m, which keeps
 * a listing inside the locality it claims while stopping every flat in Baner stacking on one pixel.
 */

/* Pune (Shivajinagar). Only reached by a listing whose locality is not in the registry, which the
   posting wizard does not allow — it exists so a hand-written fixture cannot produce `NaN`. */
const CITY_CENTRE = [18.5204, 73.8567];

/** ~0.0045 degrees is a little under 500 m at Pune's latitude. */
const SPREAD = 0.0045;

/**
 * The stored position for a listing, or its locality-anchored stand-in.
 *
 * @param {object} p a listing with `id` and `localitySlug`
 * @returns {[number, number]} `[lat, lng]`
 */
export function seedPosition(p) {
  const loc = localityBySlug(p?.localitySlug);
  const base = loc && loc.lat != null && loc.lng != null ? [loc.lat, loc.lng] : CITY_CENTRE;
  const h = fnvHash(p?.id || '');
  return [
    base[0] + (((h % 9) - 4) * SPREAD),
    base[1] + ((((h >> 8) % 9) - 4) * SPREAD),
  ];
}

/**
 * Fill in `lat`/`lng` for a listing that has none. A row that already carries coordinates — every
 * live row, and any owner-posted one — is returned untouched: real data always wins.
 */
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
