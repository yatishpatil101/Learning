/** A bare JSON array, not a PageResponse, so there is nothing to unwrap. */
import { get, post } from '../../http.js';

/** A number that may be absent: below three live listings the server sends none, and coercing that to 0 would render "₹0 per sq ft". */
const maybeNumber = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

const toLocality = (row) => {
  // Not nullable: the server computes this on read, so 0 means "none here", which is a fact.
  const liveListings = Number(row?.liveListings) || 0;
  return {
    slug: String(row?.slug || ''),
    name: String(row?.name || ''),
    city: String(row?.city || ''),
    liveListings,
    indexable: !!row?.indexable,
    archived: !!row?.archived,
    // Null below three live listings (each also needs 3 flats of its kind): a gap, never a zero.
    avgRent: maybeNumber(row?.avgRent),
    ratePerSqft: maybeNumber(row?.ratePerSqft),
    lat: maybeNumber(row?.lat),
    lng: maybeNumber(row?.lng),
  };
};

/** Every locality, alphabetical. Public — no token, no session short-circuit. */
export async function listLocalities() {
  const rows = await get('/localities');
  return (Array.isArray(rows) ? rows : []).map(toLocality);
}

/** One locality page's data. A 404 throws, so the page can tell "unknown" from "failed". */
export async function getLocality(slug) {
  return toLocality(await get(`/localities/${encodeURIComponent(slug)}`));
}

const toSummary = (row) => ({
  slug: String(row?.slug || ''),
  name: String(row?.name || ''),
  city: String(row?.city || ''),
  lat: maybeNumber(row?.lat),
  lng: maybeNumber(row?.lng),
});

/** Turns a Google place into a locality row; 422 and 503 are left to throw so the picker can tell them apart. */
export async function resolveLocality({ placeId, name, lat, lng, types }) {
  return toSummary(await post('/localities/resolve', { placeId, name, lat, lng, types }));
}

/** Active localities whose name matches `q`. The picker's fallback when Google has nothing. */
export async function searchLocalities(q) {
  const rows = await get('/localities/search', { q, limit: 10 });
  return (Array.isArray(rows) ? rows : []).map(toSummary);
}
