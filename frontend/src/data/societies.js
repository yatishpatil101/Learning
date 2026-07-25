// Society entities — first-class, Pune-first. Single source of truth for the
// Society Hub (consumer profile page + property Society section).
//
// Data is curated/deterministic (no backend). The record shape is intentionally
// "ownership-ready": `claimStatus`, `adminId` and `members` are reserved for Phase 2
// (society claim + admin edit) and Phase 3 (Society OS SaaS) and are unused in Phase 1.
import { fnvHash } from '../lib/hash.js';
import { RERA_SOCIETIES } from './societies-rera.js';

// water: 'Corporation' | '24x7 Corp + Borewell' | 'Tanker + Borewell'
// power: backup coverage. petPolicy/vegPolicy: 'Allowed' | 'Not allowed' | 'Common areas only' | 'Mixed'
export const SOCIETIES = [
  { id: 'S01', slug: 'skyline-heights-baner', name: 'Skyline Heights', builder: 'Kolte-Patil', localitySlug: 'baner', lat: 18.5602, lng: 73.7861, year: 2018, towers: 5, units: 420, occupancy: 92, maintenancePerSqft: 3.2, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.4, lifts: 12, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100012345', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging'] },
  { id: 'S02', slug: 'green-meadows-baner', name: 'Green Meadows', builder: 'Gera Developments', localitySlug: 'baner', lat: 18.5571, lng: 73.7902, year: 2016, towers: 3, units: 260, occupancy: 95, maintenancePerSqft: 2.9, water: 'Corporation', power: 'Lifts + common areas', parkingRatio: 1.2, lifts: 6, security: '2-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100011876', registration: true, conveyance: true, amenities: ['gym', 'clubhouse', 'garden', 'kids', 'security', 'jogging'] },
  { id: 'S03', slug: 'silver-oak-residency-aundh', name: 'Silver Oak Residency', builder: 'Rohan Builders', localitySlug: 'aundh', lat: 18.5605, lng: 73.8071, year: 2014, towers: 4, units: 300, occupancy: 97, maintenancePerSqft: 3.0, water: 'Corporation', power: 'Full DG backup', parkingRatio: 1.3, lifts: 8, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: '', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'security', 'indoor'] },
  { id: 'S04', slug: 'marvel-fria-wagholi', name: 'Marvel Fria', builder: 'Marvel Realtors', localitySlug: 'wagholi', lat: 18.5793, lng: 73.9871, year: 2019, towers: 7, units: 640, occupancy: 84, maintenancePerSqft: 2.6, water: 'Tanker + Borewell', power: 'Full DG backup', parkingRatio: 1.5, lifts: 14, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100019234', registration: true, conveyance: false, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging', 'sports'] },
  { id: 'S05', slug: 'kumar-palaash-hinjawadi', name: 'Kumar Palaash', builder: 'Kumar Properties', localitySlug: 'hinjawadi', lat: 18.5921, lng: 73.7402, year: 2017, towers: 6, units: 520, occupancy: 90, maintenancePerSqft: 2.8, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.3, lifts: 12, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100014521', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev'] },
  { id: 'S06', slug: 'nyati-elysia-kharadi', name: 'Nyati Elysia', builder: 'Nyati Group', localitySlug: 'kharadi', lat: 18.5518, lng: 73.9441, year: 2020, towers: 8, units: 720, occupancy: 88, maintenancePerSqft: 3.1, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.5, lifts: 16, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100021009', registration: true, conveyance: false, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging', 'sports', 'indoor'] },
  { id: 'S07', slug: 'amanora-park-hadapsar', name: 'Amanora Park Town', builder: 'City Corporation Ltd', localitySlug: 'hadapsar', lat: 18.5162, lng: 73.9291, year: 2013, towers: 12, units: 1400, occupancy: 96, maintenancePerSqft: 3.4, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.4, lifts: 30, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100010023', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging', 'sports', 'indoor', 'mall'] },
  { id: 'S08', slug: 'blue-ridge-towers-hinjawadi', name: 'Blue Ridge Towers', builder: 'Paranjape Schemes', localitySlug: 'hinjawadi', lat: 18.5889, lng: 73.7351, year: 2015, towers: 9, units: 900, occupancy: 91, maintenancePerSqft: 2.7, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.3, lifts: 18, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100013340', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'jogging', 'sports'] },
  { id: 'S09', slug: 'lunkad-sky-station-viman-nagar', name: 'Lunkad Sky Station', builder: 'Lunkad Group', localitySlug: 'viman-nagar', lat: 18.5661, lng: 73.9142, year: 2016, towers: 4, units: 340, occupancy: 93, maintenancePerSqft: 3.3, water: 'Corporation', power: 'Full DG backup', parkingRatio: 1.3, lifts: 10, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: '', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'security', 'ev'] },
  { id: 'S10', slug: 'gera-world-of-joy-kharadi', name: 'Gera World of Joy', builder: 'Gera Developments', localitySlug: 'kharadi', lat: 18.5495, lng: 73.9478, year: 2019, towers: 6, units: 560, occupancy: 86, maintenancePerSqft: 3.0, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.4, lifts: 12, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100020115', registration: true, conveyance: false, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging'] },
  { id: 'S11', slug: 'mont-vert-tropez-wakad', name: 'Mont Vert Tropez', builder: 'Mont Vert Homes', localitySlug: 'wakad', lat: 18.6081, lng: 73.7628, year: 2015, towers: 5, units: 400, occupancy: 94, maintenancePerSqft: 2.8, water: 'Corporation', power: 'Full DG backup', parkingRatio: 1.3, lifts: 10, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100012788', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security'] },
  { id: 'S12', slug: 'rohan-abhilasha-pimple-saudagar', name: 'Rohan Abhilasha', builder: 'Rohan Builders', localitySlug: 'pimple-saudagar', lat: 18.5981, lng: 73.8021, year: 2017, towers: 6, units: 480, occupancy: 92, maintenancePerSqft: 2.9, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.3, lifts: 12, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100015567', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'jogging'] },
  { id: 'S13', slug: 'kolte-patil-24k-baner', name: 'Kolte-Patil 24K Glamore', builder: 'Kolte-Patil', localitySlug: 'baner', lat: 18.5544, lng: 73.7831, year: 2021, towers: 3, units: 180, occupancy: 78, maintenancePerSqft: 4.2, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.8, lifts: 8, security: '3-tier + CCTV + app', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100022341', registration: true, conveyance: false, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging', 'sports', 'indoor', 'concierge'] },
  { id: 'S14', slug: 'godrej-infinity-mundhwa', name: 'Godrej Infinity', builder: 'Godrej Properties', localitySlug: 'magarpatta', lat: 18.5211, lng: 73.9251, year: 2018, towers: 7, units: 680, occupancy: 89, maintenancePerSqft: 3.2, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.4, lifts: 14, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100018890', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging'] },
  { id: 'S15', slug: 'majestique-towers-kharadi', name: 'Majestique Towers', builder: 'Majestique Landmarks', localitySlug: 'kharadi', lat: 18.5533, lng: 73.9412, year: 2016, towers: 5, units: 440, occupancy: 90, maintenancePerSqft: 2.9, water: 'Corporation', power: 'Full DG backup', parkingRatio: 1.3, lifts: 10, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100013912', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'security', 'ev'] },
  { id: 'S16', slug: 'vtp-urban-nest-undri', name: 'VTP Urban Nest', builder: 'VTP Realty', localitySlug: 'undri', lat: 18.4631, lng: 73.9051, year: 2020, towers: 8, units: 760, occupancy: 82, maintenancePerSqft: 2.5, water: 'Tanker + Borewell', power: 'Full DG backup', parkingRatio: 1.4, lifts: 16, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100020778', registration: true, conveyance: false, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging', 'sports'] },
  { id: 'S17', slug: 'paranjape-blue-ridge-hinjawadi', name: 'Forest Trails', builder: 'Paranjape Schemes', localitySlug: 'hinjawadi', lat: 18.5951, lng: 73.7301, year: 2014, towers: 10, units: 1100, occupancy: 93, maintenancePerSqft: 2.7, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.3, lifts: 22, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100011234', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'jogging', 'sports', 'indoor'] },
  { id: 'S18', slug: 'nyati-esteban-undri', name: 'Nyati Esteban', builder: 'Nyati Group', localitySlug: 'undri', lat: 18.4602, lng: 73.9012, year: 2018, towers: 6, units: 540, occupancy: 85, maintenancePerSqft: 2.6, water: 'Tanker + Borewell', power: 'Full DG backup', parkingRatio: 1.3, lifts: 12, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100017654', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev'] },
  { id: 'S19', slug: 'the-address-balewadi', name: 'The Address by GS', builder: 'Goel Ganga', localitySlug: 'balewadi', lat: 18.5751, lng: 73.7671, year: 2019, towers: 5, units: 420, occupancy: 87, maintenancePerSqft: 3.1, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.4, lifts: 12, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100019012', registration: true, conveyance: false, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging'] },
  { id: 'S20', slug: 'pristine-prolife-bavdhan', name: 'Pristine Prolife', builder: 'Pristine Properties', localitySlug: 'bavdhan', lat: 18.5221, lng: 73.7821, year: 2016, towers: 4, units: 320, occupancy: 91, maintenancePerSqft: 2.8, water: 'Corporation', power: 'Full DG backup', parkingRatio: 1.3, lifts: 8, security: '2-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100013001', registration: true, conveyance: true, amenities: ['gym', 'clubhouse', 'garden', 'kids', 'security', 'jogging'] },
  { id: 'S21', slug: 'kohinoor-tinseltown-hinjawadi', name: 'Kohinoor Tinsel Town', builder: 'Kohinoor Group', localitySlug: 'hinjawadi', lat: 18.5901, lng: 73.7451, year: 2020, towers: 7, units: 620, occupancy: 83, maintenancePerSqft: 2.9, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.4, lifts: 14, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100021456', registration: true, conveyance: false, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging', 'sports'] },
  { id: 'S22', slug: 'ganga-legend-bavdhan', name: 'Ganga Legend', builder: 'Goel Ganga', localitySlug: 'bavdhan', lat: 18.5241, lng: 73.7791, year: 2017, towers: 6, units: 500, occupancy: 90, maintenancePerSqft: 2.9, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.3, lifts: 12, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100015123', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'jogging'] },
  { id: 'S23', slug: 'life-republic-hinjawadi', name: 'Life Republic', builder: 'Kolte-Patil', localitySlug: 'hinjawadi', lat: 18.5871, lng: 73.7281, year: 2015, towers: 14, units: 1600, occupancy: 92, maintenancePerSqft: 2.6, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.3, lifts: 28, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100010912', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging', 'sports', 'indoor', 'mall'] },
  { id: 'S24', slug: 'saarrthi-skybay-wakad', name: 'Saarrthi Skybay', builder: 'Saarrthi Group', localitySlug: 'wakad', lat: 18.6051, lng: 73.7601, year: 2018, towers: 4, units: 360, occupancy: 88, maintenancePerSqft: 2.9, water: 'Corporation', power: 'Full DG backup', parkingRatio: 1.3, lifts: 10, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100017321', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'security', 'ev'] },
  { id: 'S25', slug: 'panchshil-towers-kharadi', name: 'Panchshil Towers', builder: 'Panchshil Realty', localitySlug: 'kharadi', lat: 18.5471, lng: 73.9501, year: 2019, towers: 5, units: 300, occupancy: 80, maintenancePerSqft: 4.5, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 2.0, lifts: 12, security: '3-tier + CCTV + app', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100022890', registration: true, conveyance: false, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging', 'sports', 'indoor', 'concierge', 'spa'] },
  { id: 'S26', slug: 'mahindra-antheia-pimpri', name: 'Mahindra Antheia', builder: 'Mahindra Lifespaces', localitySlug: 'pimple-saudagar', lat: 18.5951, lng: 73.8051, year: 2016, towers: 8, units: 700, occupancy: 93, maintenancePerSqft: 3.0, water: '24x7 Corp + Borewell', power: 'Full DG backup', parkingRatio: 1.3, lifts: 16, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: 'P52100014098', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging', 'sports'] },
  { id: 'S27', slug: 'oxford-village-wanowrie', name: 'Oxford Village', builder: 'Vilas Javdekar', localitySlug: 'magarpatta', lat: 18.5181, lng: 73.9291, year: 2014, towers: 6, units: 520, occupancy: 94, maintenancePerSqft: 2.8, water: 'Corporation', power: 'Full DG backup', parkingRatio: 1.2, lifts: 12, security: '3-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: '', registration: true, conveyance: true, amenities: ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'jogging'] },
  { id: 'S28', slug: 'aditya-shagun-kothrud', name: 'Aditya Shagun', builder: 'Aditya Builders', localitySlug: 'kothrud', lat: 18.5081, lng: 73.8211, year: 2013, towers: 3, units: 210, occupancy: 98, maintenancePerSqft: 3.1, water: 'Corporation', power: 'Full DG backup', parkingRatio: 1.2, lifts: 6, security: '2-tier + CCTV', petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: '', registration: true, conveyance: true, amenities: ['gym', 'clubhouse', 'garden', 'security', 'indoor'] },
];

// Verified catalogue = 28 curated demo societies + the MahaRERA bulk import.
// RERA rows are lookup-/search-visible immediately, but the hash-fallback pool
// used for LEGACY unbound listings stays the curated set (see societyForListing)
// so existing demo hubs keep their listing density.
const CATALOGUE = SOCIETIES.concat(RERA_SOCIETIES);
const BY_SLUG = Object.fromEntries(CATALOGUE.map((s) => [s.slug, s]));
const BY_ID = Object.fromEntries(CATALOGUE.map((s) => [s.id, s]));

// Merge map (ops dedup): a duplicate society's slug → its canonical slug. Kept
// here (dependency-free) so every lookup transparently redirects a merged-away
// society to its canonical row. store.js calls registerSocietyMerges() on load.
const MERGES_BY_SLUG = {};
export function registerSocietyMerges(map) {
  Object.entries(map || {}).forEach(([from, to]) => { if (from && to) MERGES_BY_SLUG[from] = to; });
}
const resolveMergedSlug = (slug) => {
  let cur = slug;
  for (let i = 0; cur && MERGES_BY_SLUG[cur] && i < 8; i += 1) cur = MERGES_BY_SLUG[cur];
  return cur;
};

// Community societies — user-minted from the listing flow (tier: 'community').
// They live in localStorage (see store.js) but are registered here at runtime so
// every lookup (by slug / by id / for a listing) transparently resolves them
// alongside the curated catalogue. societies.js stays dependency-free.
const COMMUNITY = [];
const COMMUNITY_BY_SLUG = {};
const COMMUNITY_BY_ID = {};
export function registerCommunitySocieties(list) {
  (list || []).forEach((s) => {
    if (!s || !s.slug) return;
    const existing = COMMUNITY_BY_SLUG[s.slug];
    if (existing) {
      // Update in place so a tier upgrade (ops verify) reflects immediately in the
      // live lookup maps — the array + both maps share this same reference.
      Object.assign(existing, s);
      COMMUNITY_BY_ID[existing.id] = existing;
      return;
    }
    COMMUNITY.push(s);
    COMMUNITY_BY_SLUG[s.slug] = s;
    COMMUNITY_BY_ID[s.id] = s;
  });
}

// Turn a society name (optionally + locality) into a stable, URL-safe slug.
export const slugifySociety = (name, locality) =>
  [name, locality].filter(Boolean).join(' ').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const societyBySlug = (slug) => {
  const s = resolveMergedSlug(slug);
  return BY_SLUG[s] || COMMUNITY_BY_SLUG[s] || null;
};
export const societyById = (id) => {
  const rec = BY_ID[id] || COMMUNITY_BY_ID[id];
  if (!rec) return null;
  const merged = resolveMergedSlug(rec.slug);
  return merged === rec.slug ? rec : (BY_SLUG[merged] || COMMUNITY_BY_SLUG[merged] || rec);
};
export const societiesInLocality = (localitySlug) => SOCIETIES.filter((s) => s.localitySlug === localitySlug);
// Full catalogue (curated + RERA + community), minus societies merged away by ops
// — used by the society search/typeahead so duplicates disappear after a merge.
export const allSocieties = () =>
  CATALOGUE.concat(COMMUNITY).filter((s) => !MERGES_BY_SLUG[s.slug]);

// Deterministically map a listing to a society. Prefers an explicit `societyId`
// binding (curated or community) so the assignment is honest; only when a listing
// is truly unbound (legacy data) does it fall back to a locality-scoped, id-stable
// hash so the Society Hub still has something to show.
export function societyForListing(p) {
  if (!p) return null;
  if (p.societyId) {
    const bound = societyById(p.societyId);
    if (bound) return bound;
  }
  const pool = societiesInLocality(p.localitySlug);
  const set = pool.length ? pool : SOCIETIES;
  return set[fnvHash(p.id || '') % set.length];
}

// All listings that map to a given society (from a pre-fetched listing array).
export const listingsInSociety = (listings, socId) =>
  (listings || []).filter((l) => { const s = societyForListing(l); return s && s.id === socId; });
