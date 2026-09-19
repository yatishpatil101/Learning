/* Build the Maharashtra reference workbook from the MahaRERA map dataset.
 *
 * Every source field gets its OWN column and is written verbatim after
 * null-normalisation -- no concatenation, no derived "address" string. The
 * licence permits reproduction on condition it is accurate and attributed, so
 * the workbook carries a Source sheet with the attribution and fetch date, and
 * the one place the portal's own label is wrong is renamed rather than
 * silently passed through (see below).
 *
 * Run: node tools/maharera/to-excel.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { ATTRIBUTION, MAP_URL, readJson } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(ROOT, 'data', 'maharera');
const OUT = join(DATA, 'maharera-projects.xlsx');

const rows = readJson(join(DATA, 'map-rows.json'));
const meta = readJson(join(DATA, 'map-meta.json'));

/* The list crawl supplies the project name, which the map payload does not
   carry. It runs for hours, so the workbook is generated with whatever has
   landed and simply leaves the column blank for the rest -- a blank cell is
   honest, a promoter name in a "Project" column would not be. */
const names = new Map();
const jsonl = join(DATA, 'list-rows.jsonl');
if (existsSync(jsonl)) {
  const { readFileSync } = await import('node:fs');
  for (const line of readFileSync(jsonl, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.rera && r.projectName) names.set(r.rera, r);
    } catch { /* a partially-written final line during a live crawl */ }
  }
}

const COLUMNS = [
  { header: 'RERA Registration No', key: 'rera', width: 20 },
  { header: 'Project Name (list page)', key: 'projectName', width: 34 },
  { header: 'Promoter / Builder (map field "projectName")', key: 'promoter', width: 34 },
  { header: 'District', key: 'district', width: 16 },
  { header: 'Taluka', key: 'taluka', width: 18 },
  { header: 'Village', key: 'village', width: 22 },
  { header: 'Locality', key: 'locality', width: 26 },
  { header: 'Street', key: 'street', width: 30 },
  { header: 'Pincode', key: 'pincode', width: 10 },
  { header: 'Survey / Plot No (field "plotBearing")', key: 'surveyNo', width: 22 },
  { header: 'Latitude', key: 'lat', width: 14 },
  { header: 'Longitude', key: 'lng', width: 14 },
  { header: 'Division', key: 'division', width: 14 },
  { header: 'State', key: 'state', width: 14 },
  { header: 'Last Modified (list page)', key: 'lastModified', width: 18 },
  { header: 'Detail page ID', key: 'viewId', width: 14 },
];

const enrich = (r) => {
  const n = names.get(r.rera);
  return { ...r, projectName: n?.projectName ?? null, lastModified: n?.lastModified ?? null, viewId: n?.viewId ?? null };
};

const styleSheet = (ws) => {
  ws.columns = COLUMNS;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };
};

const wb = new ExcelJS.Workbook();
wb.creator = 'MahaRERA import tool';
wb.created = new Date();

const source = wb.addWorksheet('Source & Licence');
source.columns = [{ width: 24 }, { width: 110 }];
[
  ['Source', 'MahaRERA — Maharashtra Real Estate Regulatory Authority'],
  ['URL', MAP_URL],
  ['Fetched at', meta.fetchedAt],
  ['Rows', rows.length],
  ['Districts', meta.districts?.length ?? ''],
  ['Unique RERA IDs', meta.uniqueReraIds ?? ''],
  ['Attribution', ATTRIBUTION],
  ['', ''],
  ['Important', 'The map endpoint labels the PROMOTER as "projectName". Verified against the list page for five known registrations (e.g. P52100006356 = promoter "Immense Realty", project "Immense Heights"). The column is renamed here so the data is not reproduced in a misleading context.'],
  ['Project names', `Sourced separately from the paginated list pages. ${names.size.toLocaleString()} of ${rows.length.toLocaleString()} filled at generation time; blanks mean that page had not yet been crawled.`],
  ['Coverage', 'RERA covers registrations from 2017 onward. Societies completed before then are not in this dataset.'],
].forEach(([k, v]) => {
  const row = source.addRow([k, v]);
  row.getCell(1).font = { bold: true };
  row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
});

const all = wb.addWorksheet('All Maharashtra');
styleSheet(all);
rows.forEach((r) => all.addRow(enrich(r)));

const pune = wb.addWorksheet('Pune district');
styleSheet(pune);
rows.filter((r) => r.district === 'Pune').forEach((r) => pune.addRow(enrich(r)));

const summary = wb.addWorksheet('By district');
summary.columns = [
  { header: 'District', key: 'district', width: 24 },
  { header: 'Projects', key: 'n', width: 12 },
  { header: 'With coordinates', key: 'coords', width: 18 },
  { header: 'Coordinate coverage', key: 'pct', width: 20 },
];
summary.getRow(1).font = { bold: true };
const byDistrict = new Map();
for (const r of rows) {
  const d = r.district ?? '(blank)';
  const e = byDistrict.get(d) ?? { district: d, n: 0, coords: 0 };
  e.n++;
  if (r.lat != null && r.lng != null) e.coords++;
  byDistrict.set(d, e);
}
[...byDistrict.values()]
  .sort((a, b) => b.n - a.n)
  .forEach((e) => summary.addRow({ ...e, pct: e.n ? e.coords / e.n : 0 }));
summary.getColumn('pct').numFmt = '0.0%';

mkdirSync(DATA, { recursive: true });
await wb.xlsx.writeFile(OUT);
console.log(`wrote ${OUT}`);
console.log(`  All Maharashtra: ${rows.length.toLocaleString()} rows across ${byDistrict.size} districts`);
console.log(`  Pune district:   ${rows.filter((r) => r.district === 'Pune').length.toLocaleString()} rows`);
console.log(`  Project names:   ${names.size.toLocaleString()} filled (crawl in progress)`);
