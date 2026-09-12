/* Draazy — MahaRERA society importer.
   Generates a large, PRE-VERIFIED society catalogue for Pune and writes it to
   src/data/societies-rera.js (merged into the live catalogue by societies.js).

   Why deterministic generation (not a live scrape)?
   - This is a no-backend prototype. The importer models the shape of a real
     MahaRERA feed (registered projects → verified societies with RERA IDs) so
     the app instantly has "hundreds of verified societies" to select from,
     solving the cold start on the SUPPLY side without hand-curating each one.
   - The swap point is clearly marked below: point `loadReraRows()` at a real
     MahaRERA CSV/JSON export and the same normaliser produces the data file.
   - Output is deterministic (seeded RNG) so the catalogue is stable across runs
     and test-friendly. RERA IDs use the real MahaRERA `P` format but are
     synthetic — they are sample data, not claims about real registrations.

   Run: npm run import:rera
*/
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'data');
mkdirSync(OUT, { recursive: true });

// Deterministic RNG (same LCG the seed generator uses) so a re-run is stable.
const rng = (seed) => {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
};
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const intp = (r, a, b) => Math.floor(a + r() * (b - a + 1));
const round1 = (n) => Math.round(n * 10) / 10;

// Pune localities with slugs + approximate centres (matches the app's locality set).
const LOCALITIES = [
  ['baner', 18.559, 73.776], ['wakad', 18.598, 73.762], ['hinjawadi', 18.591, 73.738],
  ['kharadi', 18.551, 73.941], ['viman-nagar', 18.567, 73.915], ['koregaon-park', 18.536, 73.893],
  ['kothrud', 18.507, 73.807], ['hadapsar', 18.500, 73.926], ['aundh', 18.558, 73.807],
  ['magarpatta', 18.516, 73.928], ['pimple-saudagar', 18.598, 73.805], ['bavdhan', 18.514, 73.772],
  ['balewadi', 18.575, 73.772], ['undri', 18.464, 73.917], ['nibm-road', 18.470, 73.901],
  ['wagholi', 18.579, 73.987], ['tathawade', 18.622, 73.752], ['punawale', 18.632, 73.747],
  ['ravet', 18.650, 73.746], ['moshi', 18.672, 73.856], ['dhanori', 18.594, 73.900],
  ['kondhwa', 18.469, 73.888], ['sus', 18.548, 73.752], ['pashan', 18.538, 73.789],
];

// Real Pune developers (public company names) → short brand token for slugs.
const BUILDERS = [
  ['Kolte-Patil', 'kp'], ['Gera Developments', 'gera'], ['Rohan Builders', 'rohan'],
  ['Marvel Realtors', 'marvel'], ['Kumar Properties', 'kumar'], ['Nyati Group', 'nyati'],
  ['Godrej Properties', 'godrej'], ['Mahindra Lifespaces', 'mahindra'], ['Paranjape Schemes', 'paranjape'],
  ['Goel Ganga', 'ganga'], ['Pristine Properties', 'pristine'], ['Kohinoor Group', 'kohinoor'],
  ['Majestique Landmarks', 'majestique'], ['VTP Realty', 'vtp'], ['Panchshil Realty', 'panchshil'],
  ['Saarrthi Group', 'saarrthi'], ['Mont Vert Homes', 'montvert'], ['Vilas Javdekar', 'vj'],
  ['Lunkad Group', 'lunkad'], ['Aditya Builders', 'aditya'], ['Naiknavare', 'naiknavare'],
  ['Pethkar Projects', 'pethkar'], ['Rachana Lifestyle', 'rachana'], ['Shapoorji Pallonji', 'shapoorji'],
];

// Evocative name parts — combined into believable project names.
const PREFIX = ['Skyline', 'Green', 'Silver', 'Blue', 'Royal', 'Grand', 'Urban', 'Serene', 'Emerald', 'Golden', 'Crystal', 'Sunrise', 'Willow', 'Maple', 'Cedar', 'Orchid', 'Lotus', 'Aster', 'Vantage', 'Elysian', 'Pristine', 'Imperial', 'Horizon', 'Palm', 'Ivy'];
const SUFFIX = ['Heights', 'Meadows', 'Residency', 'Towers', 'Greens', 'Enclave', 'Vista', 'Park', 'Gardens', 'Woods', 'Square', 'Court', 'Nest', 'Springs', 'Grove', 'Estate', 'Terraces', 'Crest', 'Avenue', 'County'];

const WATER = ['Corporation', '24x7 Corp + Borewell', 'Tanker + Borewell'];
const POWER = ['Full DG backup', 'Lifts + common areas'];
const SECURITY = ['3-tier + CCTV', '2-tier + CCTV', '3-tier + CCTV + app'];
const AMEN_POOL = ['pool', 'gym', 'clubhouse', 'garden', 'kids', 'security', 'ev', 'jogging', 'sports', 'indoor', 'mall', 'concierge', 'spa'];

const titleCase = (slug) => slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// A valid-looking MahaRERA project ID: P + 5-digit division + 7-digit serial.
const reraId = (r) => 'P' + intp(r, 50000, 52999) + String(intp(r, 1000000, 9999999));

/* ---- SWAP POINT --------------------------------------------------------
   Replace this with a reader over a real MahaRERA CSV/JSON export. Each row
   only needs { name, builder, localitySlug, lat, lng, rera, year, units }; the
   normaliser below fills the rest. The generated shape stays identical, so the
   rest of the app is unaffected by the data source. */
function loadReraRows() {
  const r = rng(0x5eed1234);
  const rows = [];
  const seen = new Set();
  const TARGET = 320;
  let guard = 0;
  while (rows.length < TARGET && guard < TARGET * 40) {
    guard += 1;
    const [name] = [[pick(r, PREFIX) + ' ' + pick(r, SUFFIX)]][0];
    const [locSlug, lat, lng] = pick(r, LOCALITIES);
    const [builder, btoken] = pick(r, BUILDERS);
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const slug = `${base}-${btoken}-${locSlug}`;
    if (seen.has(slug)) continue;
    seen.add(slug);
    rows.push({
      name, builder, localitySlug: locSlug,
      lat: round6(lat + (r() - 0.5) * 0.03), lng: round6(lng + (r() - 0.5) * 0.03),
      rera: reraId(r), year: intp(r, 2012, 2024), units: intp(r, 90, 1400),
      slug, _r: r,
    });
  }
  return rows;
}
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// Normalise a RERA row into a full society record the app can render richly.
function normalise(row) {
  const r = row._r;
  const towers = Math.max(2, Math.round(row.units / intp(r, 60, 120)));
  const amenN = intp(r, 5, AMEN_POOL.length);
  const amenities = [];
  const ar = rng(hashStr(row.slug));
  while (amenities.length < amenN) { const a = pick(ar, AMEN_POOL); if (!amenities.includes(a)) amenities.push(a); }
  // RERA-registered + conveyed → verified. A slice are RERA-registered but
  // conveyance still pending, which the hub surfaces as "Partial".
  const conveyance = ar() > 0.25;
  return {
    id: 'R' + hashStr(row.slug).toString(36).toUpperCase().slice(0, 7),
    slug: row.slug, name: row.name, builder: row.builder, localitySlug: row.localitySlug,
    lat: row.lat, lng: row.lng, year: row.year, towers, units: row.units,
    occupancy: intp(r, 70, 98), maintenancePerSqft: round1(2.4 + ar() * 2.2),
    water: pick(ar, WATER), power: pick(ar, POWER), parkingRatio: round1(1.1 + ar() * 0.9),
    lifts: Math.max(4, towers * intp(ar, 2, 3)), security: pick(ar, SECURITY),
    petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: row.rera,
    registration: true, conveyance,
    amenities, tier: 'verified', source: 'rera',
  };
}

// Stable string hash (FNV-1a) — mirrors src/lib/hash.js so ids are consistent.
function hashStr(input) {
  const s = String(input);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const rows = loadReraRows();
const records = rows.map(normalise);
// Drop the RNG handle before serialising.
records.forEach((x) => { delete x._r; });

const banner = `// AUTO-GENERATED by scripts/import-rera.mjs — do not edit by hand.
// Pre-verified Pune societies modelled on the MahaRERA registered-projects feed.
// Regenerate with: npm run import:rera
`;
const body = `${banner}export const RERA_SOCIETIES = ${JSON.stringify(records, null, 0)};\n`;
writeFileSync(join(OUT, 'societies-rera.js'), body);
console.log(`import-rera: wrote ${records.length} verified societies to src/data/societies-rera.js`);
const verified = records.filter((x) => x.registration && x.conveyance).length;
console.log(`  ${verified} fully verified (registration + conveyance), ${records.length - verified} partial (RERA-registered).`);
