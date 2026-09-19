/* Answer the two questions that decide how the MahaRERA data is imported:
 *
 *   1. How many of Pune's 13,692 filings are actually DISTINCT societies?
 *      Large projects register per phase/wing/cluster, so the filing count is
 *      an upper bound, not a society count.
 *   2. How many land inside a locality we already curate? That is the slice
 *      that can be attached to an existing locality_slug without inventing
 *      new registry entries.
 *
 * Read-only: prints numbers, writes nothing to the app.
 * Run: node tools/maharera/analyse-pune.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { PUNE_BOX, inPuneBox, readJson } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rows = readJson(join(ROOT, 'data', 'maharera', 'map-rows.json')).filter((r) => r.district === 'Pune');

/* localities.js is an ES module in the app source; parsing the literal avoids
   importing app code (and its Vite-only resolution) into a plain node script. */
const src = readFileSync(join(ROOT, 'frontend', 'src', 'data', 'localities.js'), 'utf8');
const LOCALITIES = [...src.matchAll(/\{\s*slug:\s*'([^']+)',\s*name:\s*'([^']+)',\s*lat:\s*([\d.]+),\s*lng:\s*([\d.]+)/g)]
  .map(([, slug, name, lat, lng]) => ({ slug, name, lat: +lat, lng: +lng }));

const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`;
const km = (a, b, c, d) => {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(c - a), dLng = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/* Strip the phase/wing/tower/cluster suffix that makes one society file many
   times. Roman numerals matter: "PHASE - II" is far more common than "PHASE 2". */
const PHASE = /\b(ph(?:ase)?|wing|cluster|tower|building|bldg|sector|part|stage)\b[\s\-–—:.]*([ivxlc]+|\d+|[a-z])?\b/gi;
const baseName = (s) => (s ?? '')
  .toUpperCase()
  .replace(/[^A-Z0-9\s]/g, ' ')
  .replace(PHASE, ' ')
  .replace(/\b(\d+|[IVXLC]+)\s*$/i, ' ')
  .replace(/\s+/g, ' ')
  .trim();

console.log(`Pune district filings: ${rows.length.toLocaleString()}\n`);

// ---- 1. phase dedupe -------------------------------------------------------
/* UPPER BOUND ON COLLAPSE, not an answer. The real phase key is the project
   name ("X PHASE II" -> "X"), which lives only on the list pages the crawl is
   still fetching. Until then this groups on promoter + locality + pincode,
   which over-collapses: 28 Lavasa filings in Dasave are separate projects by
   one promoter, not 28 phases of one society. Re-run once list-rows.jsonl is
   complete to get the figure worth planning against. */
const groups = new Map();
for (const r of rows) {
  const key = [baseName(r.promoter), baseName(r.locality ?? r.village), r.pincode ?? ''].join('|');
  (groups.get(key) ?? groups.set(key, []).get(key)).push(r);
}
const multi = [...groups.values()].filter((g) => g.length > 1);
console.log('--- same promoter + locality + pincode (upper bound on phase collapse) ---');
console.log(`  distinct groups:        ${groups.size.toLocaleString()}`);
console.log(`  groups with >1 filing:  ${multi.length.toLocaleString()}`);
console.log(`  filings absorbed:       ${(rows.length - groups.size).toLocaleString()} (${pct(rows.length - groups.size, rows.length)})`);
console.log(`  => societies are between ${groups.size.toLocaleString()} and ${rows.length.toLocaleString()}`);
const biggest = multi.sort((a, b) => b.length - a.length).slice(0, 5);
biggest.forEach((g) => console.log(`     ${g.length.toString().padStart(3)} x  ${g[0].promoter} @ ${g[0].locality ?? g[0].village}`));

// ---- 2. locality match -----------------------------------------------------
const withCoords = rows.filter((r) => r.lat != null && r.lng != null);
const urban = withCoords.filter(inPuneBox);
console.log('\n--- geography ---');
console.log(`  with coordinates:       ${withCoords.length.toLocaleString()} (${pct(withCoords.length, rows.length)})`);
console.log(`  inside PMC/PCMC box:    ${urban.length.toLocaleString()} (${pct(urban.length, rows.length)})`);

for (const radius of [2, 3, 5]) {
  const hits = new Map();
  let matched = 0;
  for (const r of urban) {
    let best = null;
    for (const l of LOCALITIES) {
      const d = km(r.lat, r.lng, l.lat, l.lng);
      if (d <= radius && (!best || d < best.d)) best = { l, d };
    }
    if (best) { matched++; hits.set(best.l.slug, (hits.get(best.l.slug) ?? 0) + 1); }
  }
  console.log(`  within ${radius} km of a curated locality: ${matched.toLocaleString()} (${pct(matched, urban.length)} of urban) — ${hits.size}/${LOCALITIES.length} localities hit`);
  if (radius === 3) {
    console.log('    top:');
    [...hits].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .forEach(([slug, n]) => console.log(`      ${String(n).padStart(4)}  ${slug}`));
    const cold = LOCALITIES.filter((l) => !hits.has(l.slug)).map((l) => l.slug);
    if (cold.length) console.log(`    no filings within 3 km: ${cold.join(', ')}`);
  }
}

// ---- 3. locality string normalisation --------------------------------------
const raw = new Set(rows.map((r) => r.locality).filter(Boolean));
const folded = new Map();
for (const s of raw) {
  const k = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  (folded.get(k) ?? folded.set(k, []).get(k)).push(s);
}
console.log('\n--- locality strings ---');
console.log(`  distinct as written:    ${raw.size.toLocaleString()}`);
console.log(`  after case/punct fold:  ${folded.size.toLocaleString()}`);
console.log(`  collapsed by folding:   ${(raw.size - folded.size).toLocaleString()}`);

const promoters = new Set(rows.map((r) => r.promoter).filter(Boolean));
const pFold = new Set([...promoters].map((s) => s.toUpperCase().replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|AND|CO|COMPANY|DEVELOPERS?|BUILDERS?|CONSTRUCTIONS?|INFRA(STRUCTURES?)?|REALTY|ASSOCIATES?)\b/g, '').replace(/[^A-Z0-9]/g, '')));
console.log('\n--- promoters ---');
console.log(`  distinct as written:    ${promoters.size.toLocaleString()}`);
console.log(`  after suffix strip:     ${pFold.size.toLocaleString()}`);
console.log(`\nbox used: ${JSON.stringify(PUNE_BOX)}`);
