/* Build the Pune societies review workbook from the MahaRERA extract.
 *
 * WHY THE CATEGORY COLUMN IS A GUESS AND NOT A FACT
 * MahaRERA records the real project type (residential / commercial / plotted), but only on the
 * per-project detail page, and that page is behind a CAPTCHA. That is an explicit anti-automation
 * control, so we do not collect it. Everything this workbook uses comes from the two ungated
 * surfaces the portal publishes openly (the map blob and the paginated list), which carry no type
 * field at all. `categoryGuess` is therefore inferred from name tokens and shipped with the
 * evidence that produced it, so a reviewer can accept or overturn each row rather than trust it.
 *
 * ONE SOCIETY IS NOT ONE FILING
 * A society registers each phase separately, so filings must be folded. The key is
 * name + promoter + 1.5 km, and all three parts are load-bearing: name alone merges the eight
 * unrelated AARAMBH buildings by eight different promoters, while name + promoter alone merges
 * same-builder projects that sit in different suburbs.
 */
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { ATTRIBUTION, readJson } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DATA = join(ROOT, 'data', 'maharera');
const OUT = join(DATA, 'pune-societies.xlsx');

/* localities.js is app source; parsing the literal avoids importing it. */
const localitySrc = readFileSync(join(ROOT, 'frontend', 'src', 'data', 'localities.js'), 'utf8');
const LOCALITIES = [...localitySrc.matchAll(/\{\s*slug:\s*'([^']+)',\s*name:\s*'([^']+)',\s*lat:\s*([\d.]+),\s*lng:\s*([\d.]+)/g)]
  .map((m) => ({ slug: m[1], name: m[2], lat: +m[3], lng: +m[4] }));

/* ---- category inference -------------------------------------------------- */

/* Tokens are weighted because they differ in how much they prove. "ROW HOUSE" names the form
   outright; "TOWER" appears on flats and offices alike and only breaks ties. */
const SIGNALS = [
  ['Commercial', 3, /\b(COMMERCIAL|IT PARK|TECH PARK|BUSINESS (?:BAY|PARK|CENTRE|CENTER|HUB)|CORPORATE|TRADE (?:CENTRE|CENTER|PARK)|SHOPPING|MALL|MARKET|SHOWROOM|OFFICE|WAREHOUS|INDUSTRIAL|LOGISTIC|GODOWN|HOTEL|RESORT|HOSPITAL|SCHOOL|COLLEGE)\b/],
  ['Commercial', 1, /\b(PLAZA|ARCADE|EMPORIO|SQUARE|CHAMBERS|ANNEXE|MERCADO|CENTRE POINT)\b/],
  ['Plotted', 3, /\b(N\.?A\.? PLOT|PLOT(?:S|TING|TED)?|LAYOUT|LAND ?SCAPE?S?|FARM ?(?:HOUSE|LAND|PLOT)|AGRO|KRUSHI|GREEN ?FIELD|SITE)\b/],
  ['Row house', 3, /\b(ROW ?HOUSE|ROWHOUSE|BUNGALOW|VILLA(?:S|GE)?|DUPLEX|TWIN ?HOUSE|COTTAGE)\b/],
  ['Residential', 3, /\b(RESIDENC(?:Y|ES|IAL)|APARTMENT|FLAT|HOMES?|NIWAS|SADAN|VIHAR|KUNJ|ANGAN|AANGAN|CHS|CO-?OP|SOCIETY|HOUSING|ABODE|NEST|DWELLING)\b/],
  ['Residential', 1, /\b(HEIGHTS|GARDEN|ENCLAVE|PARADISE|RESIDENZA|TOWERS?|PARK|GREENS|VISTA|COURT|ELITE|ORCHID|SPRING|MEADOW)\b/],
];

/* A 'VILLA' inside 'VILLAGE' would otherwise read as a row house, so the row-house pattern
   spells VILLAGE out and we score the longest evidence first. */
function categorise(name) {
  if (!name) return { category: 'Unknown', confidence: 'none', evidence: '' };
  const n = name.toUpperCase();
  const scores = new Map();
  const seen = [];
  for (const [cat, weight, re] of SIGNALS) {
    const m = re.exec(n);
    if (!m) continue;
    scores.set(cat, (scores.get(cat) || 0) + weight);
    seen.push(`${m[0]}→${cat}(${weight})`);
  }
  if (!scores.size) return { category: 'Unknown', confidence: 'none', evidence: '' };

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [top, topScore] = ranked[0];
  const tie = ranked.length > 1 && ranked[1][1] === topScore;
  const confidence = tie ? 'low' : topScore >= 3 ? 'high' : 'low';
  return { category: tie ? 'Ambiguous' : top, confidence, evidence: seen.join(', ') };
}

/* ---- normalisation and geometry ------------------------------------------ */

const PHASE = /\b(PH|PHASE|WING|CLUSTER|TOWER|BLDG|BUILDING|SECTOR|PART|STAGE)\b\s*([IVXLC]+|\d+|[A-Z])?\b/g;
const normName = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(PHASE, ' ').replace(/\s+/g, ' ').trim();
const CORP = /\b(PVT|PRIVATE|LTD|LIMITED|LLP|AND|CO|COMPANY|DEVELOPERS?|BUILDERS?|CONSTRUCTIONS?|INFRA|INFRASTRUCTURES?|REALTY|REALTORS?|ASSOCIATES?|GROUP|ENTERPRISES?|PROJECTS?)\b/g;
const normPromoter = (s) => (s || '').toUpperCase().replace(CORP, '').replace(/[^A-Z0-9]/g, '');

function km(aLat, aLng, bLat, bLng) {
  if (aLat == null || bLat == null) return null;
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestLocality(lat, lng) {
  if (lat == null) return { slug: null, name: null, distanceKm: null };
  let best = null;
  for (const l of LOCALITIES) {
    const d = km(lat, lng, l.lat, l.lng);
    if (best === null || d < best.distanceKm) best = { slug: l.slug, name: l.name, distanceKm: d };
  }
  return best;
}

/* ---- load and join ------------------------------------------------------- */

const mapRows = readJson(join(DATA, 'map-rows.json'));
const byRera = new Map(mapRows.map((r) => [r.rera, r]));

const names = new Map();
const listPath = join(DATA, 'list-rows.jsonl');
if (existsSync(listPath)) {
  for (const line of readFileSync(listPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    names.set(r.rera, r);
  }
}

const filings = mapRows
  .filter((r) => r.district === 'Pune')
  .map((r) => {
    const l = names.get(r.rera) || {};
    const near = nearestLocality(r.lat, r.lng);
    return {
      ...r,
      projectName: l.projectName || null,
      viewId: l.viewId || null,
      lastModified: l.lastModified || null,
      nearestLocality: near.name,
      nearestLocalitySlug: near.slug,
      localityDistanceKm: near.distanceKm == null ? null : +near.distanceKm.toFixed(2),
      ...categorise(l.projectName),
    };
  });

/* Fold filings into societies. Rows with no name yet (crawl still running) cannot be folded
   safely, so each stands alone and is flagged rather than merged on promoter alone. */
const groups = new Map();
const unnamed = [];
for (const f of filings) {
  const key = normName(f.projectName);
  if (!key) { unnamed.push([f]); continue; }
  const gk = `${key}|${normPromoter(f.promoter)}`;
  if (!groups.has(gk)) groups.set(gk, []);
  groups.get(gk).push(f);
}

const societies = [];
for (const members of groups.values()) {
  const clusters = [];
  for (const f of members) {
    const hit = clusters.find((c) => {
      const d = km(f.lat, f.lng, c[0].lat, c[0].lng);
      return d === null || d <= 1.5;
    });
    if (hit) hit.push(f);
    else clusters.push([f]);
  }
  societies.push(...clusters);
}
societies.push(...unnamed);

/* Same display name, different society: the reviewer needs these flagged because a picker
   showing only the name cannot tell them apart. */
const nameCount = new Map();
for (const s of societies) {
  const k = normName(s[0].projectName);
  if (k) nameCount.set(k, (nameCount.get(k) || 0) + 1);
}

const societyRows = societies.map((members) => {
  const p = members.find((m) => m.lat != null) || members[0];
  const key = normName(p.projectName);
  const localities = [...new Set(members.map((m) => m.locality).filter(Boolean))];
  return {
    projectName: p.projectName,
    promoter: p.promoter,
    category: p.category,
    categoryConfidence: p.confidence,
    categoryEvidence: p.evidence,
    phases: members.length,
    reraIds: members.map((m) => m.rera).join(', '),
    locality: localities.join(' / '),
    village: p.village,
    taluka: p.taluka,
    pincode: p.pincode,
    street: p.street,
    surveyNo: p.surveyNo,
    lat: p.lat,
    lng: p.lng,
    nearestLocality: p.nearestLocality,
    localityDistanceKm: p.localityDistanceKm,
    nameSharedWith: key ? (nameCount.get(key) || 1) - 1 : 0,
    hasCoordinates: p.lat != null ? 'yes' : 'no',
    nameKnown: p.projectName ? 'yes' : 'not crawled yet',
    mapsUrl: p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : null,
    reraUrl: p.viewId ? `https://maharerait.maharashtra.gov.in/public/project/view/${p.viewId}` : null,
  };
});

societyRows.sort((a, b) => (a.nearestLocality || '~').localeCompare(b.nearestLocality || '~') || (a.projectName || '~').localeCompare(b.projectName || '~'));

/* ---- workbook ------------------------------------------------------------ */

const wb = new ExcelJS.Workbook();
wb.creator = 'Draazy MahaRERA import';
wb.created = new Date();

function sheet(name, columns, rows, freeze = 1) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: freeze }] });
  ws.columns = columns;
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

/* Sheet 1 — provenance and the caveats a reviewer must read before trusting a column. */
const readme = wb.addWorksheet('Source & Method');
readme.columns = [{ width: 28 }, { width: 120 }];
const notes = [
  ['Source', ATTRIBUTION],
  ['Generated', new Date().toISOString()],
  ['Scope', 'All MahaRERA filings whose district is Pune.'],
  ['', ''],
  ['HOW TO READ THIS', ''],
  ['Filings vs societies', 'A society registers each phase separately. "Pune societies" folds filings by name + promoter + 1.5 km; "Pune filings (raw)" is one row per MahaRERA registration, unfolded.'],
  ['category', 'A GUESS, not a MahaRERA field. MahaRERA records the real project type only on the per-project detail page, which is CAPTCHA-protected, so we do not collect it. This column is inferred from name tokens; categoryEvidence shows exactly which tokens fired.'],
  ['categoryConfidence', 'high = an explicit token (e.g. "ROW HOUSE"). low = only weak/ambiguous tokens, or two categories tied. none = nothing matched; treat as unreviewed.'],
  ['nameSharedWith', 'How many OTHER societies share this display name. Anything above 0 cannot be told apart by name alone in a picker — locality or promoter must be shown too.'],
  ['nameKnown', '"not crawled yet" means the name crawl has not reached this filing. Those rows cannot be folded into phases yet and may duplicate.'],
  ['lat / lng', 'From the MahaRERA map surface. Roughly 76% of Pune filings carry usable coordinates; the rest are blank, not zero.'],
  ['nearestLocality', 'Closest of our 155 curated Pune localities, with distance. A large distance means the filing sits outside our current coverage, not that the locality is wrong.'],
  ['', ''],
  ['WHAT IS DELIBERATELY ABSENT', ''],
  ['Google data', 'No Google Maps content (names, addresses, ratings, reviews) is stored here. The Maps terms permit storing only the place_id, and prohibit copying reviews or deriving content from them. mapsUrl is a link, not stored content.'],
  ['Detail-page fields', 'Unit mix, carpet areas, completion dates, building counts and the authoritative project type all live behind the CAPTCHA-gated detail page and are not collected.'],
];
notes.forEach(([k, v]) => readme.addRow([k, v]));
readme.getColumn(1).font = { bold: true };
readme.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

sheet('Pune societies', [
  { header: 'Project name', key: 'projectName', width: 38 },
  { header: 'Promoter', key: 'promoter', width: 34 },
  { header: 'Category (guess)', key: 'category', width: 16 },
  { header: 'Confidence', key: 'categoryConfidence', width: 11 },
  { header: 'Category evidence', key: 'categoryEvidence', width: 30 },
  { header: 'Phases', key: 'phases', width: 8 },
  { header: 'RERA ids', key: 'reraIds', width: 30 },
  { header: 'Locality (RERA)', key: 'locality', width: 24 },
  { header: 'Village', key: 'village', width: 18 },
  { header: 'Taluka', key: 'taluka', width: 16 },
  { header: 'Pincode', key: 'pincode', width: 10 },
  { header: 'Street', key: 'street', width: 28 },
  { header: 'Survey no', key: 'surveyNo', width: 18 },
  { header: 'Lat', key: 'lat', width: 12 },
  { header: 'Lng', key: 'lng', width: 12 },
  { header: 'Nearest curated locality', key: 'nearestLocality', width: 22 },
  { header: 'Distance (km)', key: 'localityDistanceKm', width: 13 },
  { header: 'Name shared with', key: 'nameSharedWith', width: 15 },
  { header: 'Has coordinates', key: 'hasCoordinates', width: 14 },
  { header: 'Name known', key: 'nameKnown', width: 15 },
  { header: 'Map link', key: 'mapsUrl', width: 40 },
  { header: 'MahaRERA page', key: 'reraUrl', width: 40 },
], societyRows);

sheet('Pune filings (raw)', [
  { header: 'RERA id', key: 'rera', width: 16 },
  { header: 'Project name', key: 'projectName', width: 38 },
  { header: 'Promoter', key: 'promoter', width: 34 },
  { header: 'Category (guess)', key: 'category', width: 16 },
  { header: 'Confidence', key: 'confidence', width: 11 },
  { header: 'Locality', key: 'locality', width: 24 },
  { header: 'Street', key: 'street', width: 28 },
  { header: 'Village', key: 'village', width: 18 },
  { header: 'Taluka', key: 'taluka', width: 16 },
  { header: 'District', key: 'district', width: 12 },
  { header: 'Division', key: 'division', width: 14 },
  { header: 'State', key: 'state', width: 14 },
  { header: 'Pincode', key: 'pincode', width: 10 },
  { header: 'Survey no', key: 'surveyNo', width: 22 },
  { header: 'Lat', key: 'lat', width: 12 },
  { header: 'Lng', key: 'lng', width: 12 },
  { header: 'Nearest curated locality', key: 'nearestLocality', width: 22 },
  { header: 'Distance (km)', key: 'localityDistanceKm', width: 13 },
  { header: 'Last modified', key: 'lastModified', width: 16 },
], filings);

/* Sheet 4 — the rows a name-only picker would get wrong. */
const collisions = [];
for (const [key, count] of nameCount) {
  if (count < 2) continue;
  for (const s of societies.filter((x) => normName(x[0].projectName) === key)) {
    const p = s.find((m) => m.lat != null) || s[0];
    collisions.push({
      normalisedName: key,
      sharedBy: count,
      projectName: p.projectName,
      promoter: p.promoter,
      locality: p.locality,
      nearestLocality: p.nearestLocality,
      pincode: p.pincode,
      reraIds: s.map((m) => m.rera).join(', '),
    });
  }
}
collisions.sort((a, b) => b.sharedBy - a.sharedBy || a.normalisedName.localeCompare(b.normalisedName));

sheet('Name collisions', [
  { header: 'Normalised name', key: 'normalisedName', width: 32 },
  { header: 'Societies sharing it', key: 'sharedBy', width: 18 },
  { header: 'Project name', key: 'projectName', width: 38 },
  { header: 'Promoter', key: 'promoter', width: 34 },
  { header: 'Locality', key: 'locality', width: 24 },
  { header: 'Nearest curated locality', key: 'nearestLocality', width: 22 },
  { header: 'Pincode', key: 'pincode', width: 10 },
  { header: 'RERA ids', key: 'reraIds', width: 30 },
], collisions);

/* Sheet 5 — coverage per curated locality, to show where the catalogue is thin. */
const byLocality = new Map();
for (const r of societyRows) {
  const k = r.nearestLocality || '(no coordinates)';
  if (!byLocality.has(k)) byLocality.set(k, { locality: k, societies: 0, residential: 0, commercial: 0, plotted: 0, rowHouse: 0, unknown: 0 });
  const e = byLocality.get(k);
  e.societies += 1;
  if (r.category === 'Residential') e.residential += 1;
  else if (r.category === 'Commercial') e.commercial += 1;
  else if (r.category === 'Plotted') e.plotted += 1;
  else if (r.category === 'Row house') e.rowHouse += 1;
  else e.unknown += 1;
}
const localityRows = [...byLocality.values()].sort((a, b) => b.societies - a.societies);

sheet('By locality', [
  { header: 'Nearest curated locality', key: 'locality', width: 26 },
  { header: 'Societies', key: 'societies', width: 11 },
  { header: 'Residential', key: 'residential', width: 12 },
  { header: 'Commercial', key: 'commercial', width: 12 },
  { header: 'Plotted', key: 'plotted', width: 10 },
  { header: 'Row house', key: 'rowHouse', width: 11 },
  { header: 'Unknown', key: 'unknown', width: 10 },
], localityRows);

mkdirSync(DATA, { recursive: true });
await wb.xlsx.writeFile(OUT);

const named = filings.filter((f) => f.projectName).length;
const cat = (c) => societyRows.filter((r) => r.category === c).length;
console.log(`wrote ${OUT}`);
console.log(`  Pune filings:        ${filings.length.toLocaleString()}  (names known: ${named.toLocaleString()})`);
console.log(`  folded to societies: ${societyRows.length.toLocaleString()}`);
console.log(`  category guesses:    residential ${cat('Residential')} | commercial ${cat('Commercial')} | plotted ${cat('Plotted')} | row house ${cat('Row house')} | ambiguous ${cat('Ambiguous')} | unknown ${cat('Unknown')}`);
console.log(`  name collisions:     ${collisions.length} rows across ${[...nameCount.values()].filter((n) => n > 1).length} names`);
