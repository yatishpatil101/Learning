
import { toViewModel } from './propertyMapper.js';

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

export function toSociety(row) {
  if (!row?.slug) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name || '',
    builder: row.builder || '',
    localitySlug: row.localitySlug || '',
    pincode: row.pincode || row.pinCode || row.postalCode || '',
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
    // The server's count of live listings across the merge family; `0` is a real zero, so it is
    // always projected.
    listingCount: Number(row.listingCount) || 0,
    homes: Array.isArray(row.homes) ? row.homes.map(toViewModel) : [],
  };
}
