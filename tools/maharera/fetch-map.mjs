/* Fetch the MahaRERA map payload: the entire state registry in one request.
 *
 * Writes data/maharera/map-rows.json (normalised) plus a small meta file
 * recording when the snapshot was taken, so every artefact downstream can state
 * its own as-of date rather than implying it is live.
 *
 * Run: node tools/maharera/fetch-map.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTRIBUTION, MAP_URL, UA, extractMapJson, normaliseMapRow } from './lib.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'maharera');
mkdirSync(OUT, { recursive: true });

console.log('fetching map payload (~21 MB)…');
const started = Date.now();
const res = await fetch(MAP_URL, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
if (!res.ok) throw new Error(`map page returned ${res.status}`);
const html = await res.text();
console.log(`  ${(html.length / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const raw = extractMapJson(html);
const rows = raw.map(normaliseMapRow);
console.log(`  parsed ${rows.length.toLocaleString()} rows`);

/* Duplicate registration ids exist in the source (52,528 rows, 52,479 ids). We
   keep every row rather than collapsing here: which duplicate is authoritative
   is a judgement for the dedupe stage, and a silent drop at fetch time would
   make the count unreconcilable against the portal's own total. */
const ids = new Set(rows.map((r) => r.rera).filter(Boolean));
const districts = [...new Set(rows.map((r) => r.district).filter(Boolean))].sort();

const meta = {
  fetchedAt: new Date().toISOString(),
  source: MAP_URL,
  attribution: ATTRIBUTION,
  rowCount: rows.length,
  uniqueReraIds: ids.size,
  duplicateReraIds: rows.filter((r) => r.rera).length - ids.size,
  districts,
};

writeFileSync(join(OUT, 'map-rows.json'), JSON.stringify(rows), 'utf8');
writeFileSync(join(OUT, 'map-meta.json'), JSON.stringify(meta, null, 2), 'utf8');

console.log(`  ${districts.length} districts, ${ids.size.toLocaleString()} unique RERA ids`);
console.log(`  Pune district: ${rows.filter((r) => r.district === 'Pune').length.toLocaleString()}`);
console.log(`wrote ${join(OUT, 'map-rows.json')}`);
