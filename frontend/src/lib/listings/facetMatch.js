/* ---------- listings filter query → predicate over one listing ----------
   The other half of `facetQuery.js`. That module turns the page's filter state into the query the
   server answers; this one answers the same query in the browser, so mock mode and live mode share
   one definition of what each facet means.

   It takes the *wire query*, not the filter state, on purpose. The alternative — each provider
   interpreting the raw filter state its own way — is what let the two modes drift in the first
   place: the browser had ~25 axes the server had never been asked about, and nobody could tell by
   reading either side which behaviours were intended and which were accidents. Matching against the
   query means the mock is a fake of the endpoint rather than a second implementation of the page.

   Where the two modes used to disagree, this file takes the server's answer:

   - A value the owner never stated is excluded from a narrowed range. SQL comparisons against NULL
     are never true, and the browser's `?? 0` was treating an unstated age as brand new.
   - "Under Construction" excludes listings with no stated possession. `p.construction !== 'ready'`
     was true for a listing that never said, and `IN (...)` never matches NULL.
   - A tenant filter excludes listings that state no preference, the same way `pets` and
     `availableFrom` always have. The server used to admit them; that rule never reached a user,
     because the browser was doing the filtering, and it is gone from both sides now.
   - A radius search needs real coordinates. Every row carries `lat`/`lng` — live rows from the
     database, seed rows stamped once at the mock's read boundary (`lib/listings/coords.js`) — so
     the pin the map draws and the position this filter measures are the same number. They used to
     be two: the map computed a position at render time, which is not something the server can
     compare against, so "within 2 km" was answered by a hash of the listing id. */
import { societyForListing } from '../../data/societies.js';
import { matchTypeKey, matchCommercialKey } from '../../data/propertyTypes.js';
import { haversineKm } from './coords.js';

/* PG occupancy may be a single key (legacy stock) or the list of occupancies a building offers. */
const sharingList = (p) => (Array.isArray(p.sharing) ? p.sharing : (p.sharing ? [p.sharing] : []));

/** BHK chips: `3plus` and `5` are open-ended, `0` is a studio/1RK. */
export const bhkMatch = (key, n) => {
  if (key === '3plus') return n >= 3;
  if (key === '5') return n >= 5;
  if (key === '0') return n === 0;
  return n === Number(key);
};

/** True when the listing offers any of the selected PG occupancies. */
export const offersSharing = (p, selected) => sharingList(p).some((s) => selected.includes(s));

/* Listing possession shorthand → the contract vocabulary the `construction` facet is expressed in.
   The inverse of `facetQuery.js`'s map, applied to the listing rather than to the filter. */
const CONSTRUCTION_TO_WIRE = {
  ready: 'ready-to-move',
  new: 'new-launch',
  under: 'under-construction',
};

/* Listing furnishing key → the contract vocabulary the `furnishings` facet is expressed in.
   The inverse of `facetQuery.js`'s map, applied to the listing rather than to the filter. Both
   providers hand this matcher the UI key (`semi`), so the lift happens here rather than the query
   being un-translated back down. */
const FURNISHING_TO_WIRE = {
  unfurnished: 'unfurnished',
  semi: 'semi-furnished',
  furnished: 'furnished',
};

/* Cumulative move-in buckets: "within 30 days" must also return "now" and "within 15". */
const AVAILABLE_FROM_BUCKETS = {
  now: ['now'],
  15: ['now', '15'],
  30: ['now', '15', '30'],
};

/* The two type chips that name a share rather than a kind of building (V100). */
const SHARE_KEYS = ['pg', 'flatmates'];

const has = (values) => Array.isArray(values) && values.length > 0;
const oneOf = (values, value) => value != null && values.includes(value);

/* A bound the caller did not send is not a bound. A bound they did send excludes an unstated
   value, which is what the database does and what the "3." rule in `facetQuery.js` promises. */
const withinBounds = (value, min, max) => {
  if (min == null && max == null) return true;
  if (value == null) return false;
  return (min == null || value >= min) && (max == null || value <= max);
};

/* The type chips are answered by two fields between them, exactly as `PropertySpecs.typeFacet`
   answers them with two columns: `pg` and `flatmates` name a share, everything else names a kind of
   building AND requires the listing not to be a share. A PG posted with a type of "Flat" is
   returned by `pg` and not by `flat`; several chips together are a union. */
const matchesType = (p, keys) => keys.some((key) => (
  SHARE_KEYS.includes(key) ? p.shareType === key : !p.shareType && matchTypeKey(key, p.type)
));

/**
 * Does this listing satisfy the query `facetQuery.js` produced?
 *
 * Facet-only: the approved-and-not-archived floor is the provider's, mirroring the server, where it
 * is applied outside the facet chain and cannot be widened by a caller.
 *
 * @param {object} p listing view-model (the shape both providers return).
 * @param {object} q query object from {@link toFacetQuery}; absent keys mean "not filtered".
 */
export function matchesFacetQuery(p, q = {}) {
  if (q.deal && p.deal !== q.deal) return false;

  if (q.q) {
    const needle = String(q.q).toLowerCase();
    const hit = (p.title || '').toLowerCase().includes(needle)
      || (p.locality || '').toLowerCase().includes(needle)
      || (p.localitySlug || '').includes(needle);
    if (!hit) return false;
  }

  if (has(q.types) && !matchesType(p, q.types)) return false;
  if (has(q.commercialUses)
    && !q.commercialUses.some((k) => matchCommercialKey(k, p.type))) return false;
  if (has(q.bhks) && !q.bhks.some((k) => bhkMatch(k, p.bhkNum))) return false;
  if (has(q.furnishings) && !oneOf(q.furnishings, FURNISHING_TO_WIRE[p.furnishing])) return false;
  if (has(q.localities) && !oneOf(q.localities, p.localitySlug)) return false;
  if (has(q.landUse) && !oneOf(q.landUse, p.landUse)) return false;
  if (has(q.room) && !oneOf(q.room, p.room)) return false;
  if (has(q.sharing) && !offersSharing(p, q.sharing)) return false;

  if (has(q.societies)) {
    const society = societyForListing(p);
    if (!society || !q.societies.includes(society.slug)) return false;
  }

  // Amenities are AND'd, not OR'd: every box ticked is a requirement, because a tenant who needs a
  // lift and parking is not helped by a listing with one of them.
  if (has(q.amenities)) {
    const owned = new Set(p.amenities || []);
    if (!q.amenities.every((a) => owned.has(a))) return false;
  }

  // OR'd across the selected tenant types, and a listing that stated no policy matches none of
  // them. "Unknown" is not a value a filter can match: ticking `family` asks for owners who said
  // yes to families, and an owner who never answered has not said it. Same rule as `pets` and
  // `availableFrom` below.
  if (has(q.tenants)) {
    const stated = Array.isArray(p.tenants) ? p.tenants : [];
    if (!stated.some((t) => q.tenants.includes(t))) return false;
  }

  if (has(q.construction) && !oneOf(q.construction, CONSTRUCTION_TO_WIRE[p.construction])) {
    return false;
  }
  if (q.availableFrom) {
    const bucket = AVAILABLE_FROM_BUCKETS[q.availableFrom];
    if (bucket && !oneOf(bucket, p.availableFrom)) return false;
  }

  if (q.pets && !p.pets) return false;
  if (q.ownerVerified && !p.ownerVerified) return false;
  if (q.ownershipVerified && !p.ownershipVerified) return false;
  if (q.rera && !p.rera) return false;
  if (q.societyVerified && !p.societyVerified) return false;
  if (q.conveyanceDone && !p.conveyanceDone) return false;

  if (!withinBounds(p.price, q.minPrice, q.maxPrice)) return false;
  if (!withinBounds(p.area, q.minArea, q.maxArea)) return false;
  if (!withinBounds(p.ageYears, q.minAge, q.maxAge)) return false;
  if (!withinBounds(p.floor, q.minFloor, q.maxFloor)) return false;

  if (q.nearLat != null && q.nearLng != null && q.nearRadiusKm != null) {
    if (p.lat == null || p.lng == null) return false;
    if (haversineKm(q.nearLat, q.nearLng, p.lat, p.lng) > q.nearRadiusKm) return false;
  }

  return true;
}
