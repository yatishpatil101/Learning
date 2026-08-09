/*
 * gen-catalogue-seed.mjs — regenerate the localities + societies INSERT blocks of
 * R__seed_reference_data.sql from the frontend's canonical catalogue data.
 *
 * WHY: the frontend (frontend/src/data/*.js) is the single source of truth for Pune's
 * locality and society reference data. Hand-copying 155 localities + 348 societies into
 * SQL is infeasible and drifts. This tool reads those files directly and emits the two
 * ON CONFLICT-guarded INSERT blocks, so the seed is reproducible from the repository
 * (the very property the old seed comments lamented was missing).
 *
 * The 320 MahaRERA societies (societies-rera.js) carry FULL data (lat, amenities, year,
 * occupancy) — they are NOT thin stubs, so seeding them alongside the 28 curated rows is
 * pure upside. Decision recorded 2026-08-08 (docs/system/open-questions.md / tech-debt D104).
 *
 * USAGE (from backend/):  node tools/gen-catalogue-seed.mjs
 * Prints the two SQL blocks to stdout. Exits non-zero if any society references a
 * locality slug not present in the locality set (a foreign-key violation waiting to happen).
 */

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '../../frontend/src/data');
const imp = (f) => import(pathToFileURL(resolve(dataDir, f)).href);

const { LOCALITIES } = await imp('localities.js');
const { SOCIETIES } = await imp('societies.js');
const { RERA_SOCIETIES } = await imp('societies-rera.js');

// Curated market stats for the localities that have them. Extracted from the previous
// hand-maintained seed block; every other locality gets NULL market columns (all nullable).
const MARKET = {
  aundh: [11800, 30680, 74, 'Buy'],
  balewadi: [9000, 23400, 85, 'Both'],
  baner: [9800, 25480, 88, 'Buy'],
  bavdhan: [8800, 22880, 72, 'Buy'],
  hadapsar: [7300, 18980, 80, 'Rent'],
  hinjawadi: [7600, 19760, 94, 'Rent'],
  kharadi: [9100, 23660, 86, 'Both'],
  'koregaon-park': [14500, 37700, 70, 'Buy'],
  kothrud: [11200, 29120, 78, 'Buy'],
  magarpatta: [9600, 24960, 84, 'Rent'],
  'nibm-road': [8100, 21060, 71, 'Buy'],
  'pimple-saudagar': [8400, 21840, 81, 'Both'],
  undri: [6600, 17160, 68, 'Buy'],
  'viman-nagar': [10400, 27040, 82, 'Both'],
  wakad: [8200, 21320, 90, 'Both'],
};

// ---- SQL value formatting -------------------------------------------------
const sq = (v) => "'" + String(v).replace(/'/g, "''") + "'"; // quote + escape
const txt = (v) => (v == null || v === '' ? 'NULL' : sq(v));
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 'NULL' : String(Number(v)));
const bool = (v) => (v ? 'true' : 'false');
const jsonb = (arr) => sq(JSON.stringify(Array.isArray(arr) ? arr : [])) + '::jsonb';

// ---- Localities -----------------------------------------------------------
const localitySlugs = new Set(LOCALITIES.map((l) => l.slug));

const localityRows = LOCALITIES.map((l) => {
  const [rate = null, rent = null, demand = null, focus = null] = MARKET[l.slug] || [];
  return `    (${sq(l.slug)}, ${sq(l.name)}, 'Pune', ${num(rate)}, ${num(rent)}, `
    + `${num(demand)}, ${txt(focus)}, ${num(l.lat)}, ${num(l.lng)}, true)`;
}).join(',\n');

const localitiesSql =
`INSERT INTO localities (slug, name, city, rate_per_sqft, avg_rent, demand, focus, lat, lng, active) VALUES
${localityRows}
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name, city = EXCLUDED.city, rate_per_sqft = EXCLUDED.rate_per_sqft,
    avg_rent = EXCLUDED.avg_rent, demand = EXCLUDED.demand, focus = EXCLUDED.focus,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, active = EXCLUDED.active;`;

// ---- Societies ------------------------------------------------------------
const orphans = [];
const societyRow = (s, source) => {
  if (s.localitySlug && !localitySlugs.has(s.localitySlug)) {
    orphans.push(`${s.slug} -> ${s.localitySlug}`);
  }
  return `    (${sq(s.slug)}, ${txt(s.name)}, ${txt(s.builder)}, ${txt(s.localitySlug)}, `
    + `${num(s.lat)}, ${num(s.lng)}, ${num(s.year)}, ${num(s.towers)}, ${num(s.units)}, `
    + `${num(s.occupancy)}, ${num(s.maintenancePerSqft)}, ${num(s.parkingRatio)}, ${num(s.lifts)}, `
    + `${txt(s.security)}, ${txt(s.water)}, ${txt(s.power)}, ${txt(s.petPolicy)}, ${txt(s.vegPolicy)}, `
    + `${txt(s.rera)}, ${bool(s.registration)}, ${bool(s.conveyance)}, ${jsonb(s.amenities)}, `
    + `${sq(source)}, 'unclaimed')`;
};

const societyRows = [
  ...SOCIETIES.map((s) => societyRow(s, 'curated')),
  ...RERA_SOCIETIES.map((s) => societyRow(s, 'rera')),
].join(',\n');

const societiesSql =
`INSERT INTO societies (slug, name, builder, locality_slug, lat, lng, year, towers, units,
                       occupancy, maintenance_per_sqft, parking_ratio, lifts, security, water,
                       power, pet_policy, veg_policy, rera, registration, conveyance, amenities,
                       source, claim_status) VALUES
${societyRows}
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name, builder = EXCLUDED.builder, locality_slug = EXCLUDED.locality_slug,
    lat = EXCLUDED.lat, lng = EXCLUDED.lng, year = EXCLUDED.year, towers = EXCLUDED.towers,
    units = EXCLUDED.units, occupancy = EXCLUDED.occupancy,
    maintenance_per_sqft = EXCLUDED.maintenance_per_sqft, parking_ratio = EXCLUDED.parking_ratio,
    lifts = EXCLUDED.lifts, security = EXCLUDED.security, water = EXCLUDED.water,
    power = EXCLUDED.power, pet_policy = EXCLUDED.pet_policy, veg_policy = EXCLUDED.veg_policy,
    rera = EXCLUDED.rera, registration = EXCLUDED.registration,
    conveyance = EXCLUDED.conveyance, amenities = EXCLUDED.amenities, source = EXCLUDED.source;`;

// ---- Emit -----------------------------------------------------------------
process.stderr.write(
  `[gen-catalogue-seed] localities=${LOCALITIES.length} `
  + `societies=${SOCIETIES.length}+${RERA_SOCIETIES.length}=${SOCIETIES.length + RERA_SOCIETIES.length} `
  + `orphans=${orphans.length}\n`,
);

if (orphans.length) {
  process.stderr.write('[gen-catalogue-seed] ORPHAN societies (locality_slug not in localities):\n');
  orphans.forEach((o) => process.stderr.write(`  ${o}\n`));
  process.stderr.write('Add the missing localities (or fix the slug) before seeding — the FK will reject these.\n');
  process.exit(1);
}

const LOC_HEADER =
`-- ---------------------------------------------------------------------------
-- Localities. GENERATED from frontend/src/data/localities.js by
-- backend/tools/gen-catalogue-seed.mjs -- do not hand-edit the rows below; edit the
-- frontend data (the UI ground truth) and re-run the generator with --write.
--
-- Localities are the FK target of properties.locality_slug and societies.locality_slug.
-- Market columns (rate_per_sqft/avg_rent/demand/focus) are curated stats kept in the
-- generator's MARKET overlay; the rest are NULL until curated. All ${LOCALITIES.length} rows.
-- ---------------------------------------------------------------------------`;

const SOC_HEADER =
`-- ---------------------------------------------------------------------------
-- Societies. GENERATED from frontend/src/data/societies.js (${SOCIETIES.length} curated) and
-- societies-rera.js (${RERA_SOCIETIES.length} MahaRERA). Seeding all ${SOCIETIES.length + RERA_SOCIETIES.length}: verified 2026-08-08 that the
-- RERA rows carry full data (lat, amenities, year, occupancy) -- they are NOT thin stubs, so
-- loading them is pure upside for /societies. Edit the frontend data and re-run --write; do
-- not hand-edit the rows. slug is UNIQUE and is what ON CONFLICT keys on (id defaults to
-- gen_random_uuid(), so re-runs update in place rather than duplicating).
-- ---------------------------------------------------------------------------`;

const block = LOC_HEADER + '\n' + localitiesSql + '\n\n' + SOC_HEADER + '\n' + societiesSql;

const writeIdx = process.argv.indexOf('--write');
if (writeIdx !== -1) {
  const target = process.argv[writeIdx + 1];
  const { readFileSync, writeFileSync } = await import('node:fs');
  const sql = readFileSync(target, 'utf8');
  const divider = '-- ---------------------------------------------------------------------------';
  const locHeader = sql.indexOf('-- Localities');
  const start = locHeader === -1 ? -1 : sql.lastIndexOf(divider, locHeader);
  const endAnchor = 'conveyance = EXCLUDED.conveyance, amenities = EXCLUDED.amenities, source = EXCLUDED.source;';
  const endPos = sql.indexOf(endAnchor);
  if (start === -1 || endPos === -1) {
    process.stderr.write('[gen-catalogue-seed] ERROR: could not locate the Localities/Societies region to replace.\n');
    process.exit(1);
  }
  const end = endPos + endAnchor.length;
  const eol = sql.slice(0, endPos).includes('\r\n') ? '\r\n' : '\n';
  const blockOut = block.replace(/\n/g, eol);
  const next = sql.slice(0, start) + blockOut + sql.slice(end);
  writeFileSync(target, next); // UTF-8, no BOM
  process.stderr.write(`[gen-catalogue-seed] spliced ${LOCALITIES.length} localities + ${SOCIETIES.length + RERA_SOCIETIES.length} societies into ${target}\n`);
} else {
  const outPath = process.argv[2];
  if (outPath) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outPath, block + '\n'); // UTF-8, no BOM — psql-safe
    process.stderr.write(`[gen-catalogue-seed] wrote ${outPath}\n`);
  } else {
    process.stdout.write(block + '\n');
  }
}
