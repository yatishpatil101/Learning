/**
 * HTTP locality provider — the live counterpart to `providers/mock/localityProvider.js`.
 *
 * `GET /localities` (public, no `Authorization`).
 *
 * A bare JSON array of `Locality`, not a `PageResponse` — Pune has tens of curated areas and the
 * server returns them all, alphabetical by name — so there is nothing to unwrap.
 *
 * Verified against `catalog/locality/LocalityResponse.java` and `LocalityService.list()`.
 */
import { get } from '../../http.js';

/**
 * A number that is allowed to be absent.
 *
 * The price signals are genuinely nullable: a locality with no sales has no `avgBuyPsf`, and a
 * curated area that has not been surveyed has no `demand`. Coercing those to `0` would render "₹0
 * per sq ft" and "demand 0/100", both of which read as a measurement rather than as a gap — the
 * same mistake the fees domain documents at length. So absence stays absence, and a caller that
 * wants to show a figure has to decide out loud what to do when there is none.
 */
const maybeNumber = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

const toLocality = (row) => ({
  slug: String(row?.slug || ''),
  name: String(row?.name || ''),
  city: String(row?.city || ''),
  // Not nullable: the server computes this on read, so 0 means "none here", which is a fact.
  listingCount: Number(row?.listingCount) || 0,
  avgRentPsf: maybeNumber(row?.avgRentPsf),
  avgBuyPsf: maybeNumber(row?.avgBuyPsf),
  ratePerSqft: maybeNumber(row?.ratePerSqft),
  avgRent: maybeNumber(row?.avgRent),
  demand: maybeNumber(row?.demand),
  focus: String(row?.focus || ''),
  lat: maybeNumber(row?.lat),
  lng: maybeNumber(row?.lng),
  active: row?.active !== false,
});

/** Every active locality, alphabetical. Public — no token, no session short-circuit. */
export async function listLocalities() {
  const rows = await get('/localities');
  return (Array.isArray(rows) ? rows : []).map(toLocality);
}
