import { mutateDb, rawDb } from '../../../lib/mockApi.js';

const DEFAULT_CITIES = [
  { slug: 'pune', name: 'Pune', live: true },
  { slug: 'mumbai', name: 'Mumbai', live: false },
  { slug: 'bengaluru', name: 'Bengaluru', live: false },
  { slug: 'delhi-ncr', name: 'Delhi NCR', live: false },
  { slug: 'hyderabad', name: 'Hyderabad', live: false },
];

const sortCities = (rows) => [...rows].sort(
  (a, b) => Number(b.live) - Number(a.live) || String(a.name || '').localeCompare(String(b.name || '')),
);

function ensureCities(db) {
  if (!Array.isArray(db.cities) || !db.cities.length) db.cities = structuredClone(DEFAULT_CITIES);
  return db.cities;
}

function liveListingCount(db, cityName) {
  const target = String(cityName || '').trim().toLowerCase();
  return (db.listings || []).filter((listing) =>
    !listing?.archived
    && String(listing?.status || '').toLowerCase() === 'approved'
    && String(listing?.city || '').trim().toLowerCase() === target).length;
}

/** The public city roster, computed from one shared mock store rather than from settings.geo. */
export async function listCities() {
  const db = rawDb();
  const cities = ensureCities(db).map((city) => ({
    slug: city.slug,
    name: city.name,
    live: city.live === true,
    listingCount: liveListingCount(db, city.name),
  }));
  return sortCities(cities);
}

/** Launch or pause one curated city in the shared mock store. */
export async function updateCity(slug, body) {
  mutateDb((db) => {
    const city = ensureCities(db).find((row) => row.slug === slug);
    if (!city) throw new Error(`Unknown city: ${slug}`);
    city.live = body?.live === true;
  });
  window.dispatchEvent(new CustomEvent('punenest-settings-change'));
}

