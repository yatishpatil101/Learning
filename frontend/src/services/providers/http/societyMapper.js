/**
 * Wire → view-model translation for the society domain.
 */

/**
 * Index a page of `Society` rows by slug, keeping only the rating aggregate.
 *
 * `avgRating` is passed through as **null**, never coerced to a number: the contract sends
 * `"avgRating": null` for a society with no published reviews, and `Number(null)` is 0 — the one
 * transformation that turns "nobody has rated this" into "everybody rated it one star". Same
 * reasoning as `reviewMapper.js` on the summary's `avg`.
 *
 * Rows without a slug are skipped rather than indexed under `undefined`; the slug is the only key
 * the frontend's society catalogue can join on.
 *
 * @param {object[]} rows `content` from `GET /societies`
 * @returns {Record<string, {avg: number|null, count: number}>}
 */
export function toRatingIndex(rows) {
  const index = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.slug) continue;
    index[row.slug] = {
      avg: row.avgRating == null ? null : Number(row.avgRating),
      count: Number(row.reviewCount) || 0,
    };
  }
  return index;
}

/** `null`/absent stays absent; anything else becomes a number. Guards the four decimal fields. */
const num = (v) => (v == null ? null : Number(v));

/**
 * One `SocietyDetailResponse` as the society hub reads a society.
 *
 * ## Why this projection, and why it is safe to spell out
 *
 * The hub's `soc` object used to come from `resolveSociety` — the bundled 348-row catalogue merged
 * with two `localStorage` buckets. Those two field sets are not merely similar, they are the same
 * one: `R__seed_reference_data.sql` seeds `societies` from the same rows `data/societies.js`
 * bundles, column for column and *in the same units* (`occupancy` is 92, not 0.92;
 * `maintenancePerSqft` is 3.2 rupees; `security`/`water`/`power`/`petPolicy`/`vegPolicy` are the
 * same free-text display strings on both sides). So this is a rename-free copy, and the reason to
 * write it out rather than pass the row through whole is the usual one: `SocietyDetailResponse`
 * also carries `homes` and `reviews`, which the hub reads from `propertyService` and
 * `reviewService`. A component that could reach them here would grow a dependency on data the mock
 * provider does not return, and work in one mode and not the other.
 *
 * ## `_thin`, `_community`, `_generic` are not set here
 *
 * They are the hub's own words for "this row is missing its specs" / "a member added it" / "no such
 * society", and it derives them from what it got. A mapper that stamped them would be deciding, per
 * mode, what the page is allowed to say — which is exactly the drift the seam exists to prevent.
 *
 * @param {object} row `GET /societies/{slug}`
 * @returns {object|null} `null` for a missing row, which the caller must treat as "no such society"
 *   rather than as an empty one.
 */
export function toSociety(row) {
  if (!row?.slug) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name || '',
    builder: row.builder || '',
    localitySlug: row.localitySlug || '',
    lat: num(row.lat),
    lng: num(row.lng),
    placeId: row.placeId || '',
    year: row.year ?? null,
    towers: row.towers ?? null,
    units: row.units ?? null,
    occupancy: num(row.occupancy),
    maintenancePerSqft: num(row.maintenancePerSqft),
    parkingRatio: num(row.parkingRatio),
    lifts: row.lifts ?? null,
    security: row.security || '',
    water: row.water || '',
    power: row.power || '',
    petPolicy: row.petPolicy || '',
    vegPolicy: row.vegPolicy || '',
    rera: row.rera || '',
    registration: !!row.registration,
    conveyance: !!row.conveyance,
    amenities: Array.isArray(row.amenities) ? row.amenities : [],
    source: row.source || '',
    // Kept as the timestamp the server sent, not narrowed to a boolean: the hub's badge asks
    // `!!soc.verifiedAt`, but "when ops confirmed it" is a fact worth carrying whole, and a
    // mapper that answered `true` would make the day it happened unrecoverable downstream.
    verifiedAt: row.verifiedAt || null,
    claimStatus: row.claimStatus || 'unclaimed',
  };
}

