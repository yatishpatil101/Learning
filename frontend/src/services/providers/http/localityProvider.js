/**
 * HTTP locality provider.
 *
 * `GET /localities` (public, no `Authorization`).
 *
 * A bare JSON array of `Locality`, not a `PageResponse` — Pune has tens of curated areas and the
 * server returns them all, alphabetical by name — so there is nothing to unwrap.
 *
 * Verified against `catalog/locality/LocalityResponse.java` and `LocalityService.list()`.
 */
import { get, patch } from '../../http.js';

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

/**
 * One row of the curation queue.
 *
 * `locality` — the free text the owner typed — is the field that makes the row actionable, and it is
 * the one allowed to be blank: it is exactly what failed to resolve, and some listings arrive with
 * nothing in it at all. Blank is passed through as `''` rather than filled in with the title or the
 * city, both of which would look like an answer the server had given.
 *
 * `localitySlug` is null on everything read from the queue and populated on the row returned by
 * `assignLocality` — same shape, opposite ends of the transaction, which is why one mapper serves
 * both and the caller can swap the row it is holding for the one it got back.
 */
const toQueueEntry = (row) => ({
  id: String(row?.id || ''),
  title: String(row?.title || ''),
  locality: row?.locality == null ? '' : String(row.locality),
  city: row?.city == null ? '' : String(row.city),
  lat: maybeNumber(row?.lat),
  lng: maybeNumber(row?.lng),
  status: String(row?.status || ''),
  localitySlug: row?.localitySlug ? String(row.localitySlug) : null,
  createdAt: row?.createdAt ? String(row.createdAt) : null,
});

/**
 * The listings awaiting a locality. Staff/admin.
 *
 * `total` is read from the envelope rather than derived from the array, because the array is capped
 * at 200 and the two are different numbers whenever the backlog is real. Defaulting `total` to the
 * array length when the field is missing would hide exactly that case.
 */
export async function getLocalityQueue() {
  const res = await get('/admin/locality-queue');
  const listings = (Array.isArray(res?.listings) ? res.listings : []).map(toQueueEntry);
  return { total: Number(res?.total) || 0, listings };
}

/**
 * File one listing under an area. Staff/admin.
 *
 * The 409s and the 404 are deliberately not caught here. Whether the listing was already filed, the
 * area is retired, or the slug does not exist are four different repairs for the operator, and a
 * provider that flattened them into a boolean would leave the console with nothing to say beyond
 * "that didn't work".
 */
export async function assignLocality(propertyId, slug) {
  return toQueueEntry(await patch(`/admin/locality-queue/${encodeURIComponent(propertyId)}`, { slug }));
}
