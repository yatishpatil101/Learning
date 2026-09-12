/**
 * Wire → view-model translation for the society domain.
 */

/**
 * Index a page of `Society` rows by slug, keeping only the rating aggregate. `avgRating` stays
 * **null** — `Number(null)` is 0, which turns "unrated" into "rated one star". Slugless rows skip.
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
 * One `SocietyDetailResponse` as the society hub reads a society; `null` means "no such society".
 * Written field by field so `homes`/`reviews` stay unreachable here — docs/flows/consumer/societies.md
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
    // Kept as the timestamp the server sent, not narrowed to a boolean: answering `true` would make
    // the day ops confirmed it unrecoverable downstream.
    verifiedAt: row.verifiedAt || null,
    claimStatus: row.claimStatus || 'unclaimed',
    // The server's count of live listings across the merge family; `0` is a real zero, so it is
    // always projected.
    listingCount: Number(row.listingCount) || 0,
  };
}

