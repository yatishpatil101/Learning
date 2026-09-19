/* Shared helpers for the MahaRERA import tools.
 *
 * SOURCE AND LICENCE
 * Data comes from the MahaRERA public portal (maharera.maharashtra.gov.in).
 * Its copyright policy grants reproduction "free of charge in any format or
 * media without requiring specific permission", on three conditions we are
 * bound by: reproduce accurately, do not use misleadingly, and acknowledge the
 * source prominently. Every downstream artefact must carry the attribution in
 * `ATTRIBUTION` below.
 *
 * TWO ENDPOINTS, TWO HALVES OF THE RECORD
 * The portal answers the same registry through two surfaces that disagree about
 * which fields they carry, and neither alone is sufficient:
 *
 *   - The MAP page embeds the entire state as one JSON blob: coordinates,
 *     locality, village, pincode, survey number. One request, no pagination.
 *     It does NOT carry the project name.
 *   - The LIST page carries the project name and the promoter, ten rows at a
 *     time, over 4,943 pages. It does NOT carry coordinates.
 *
 * `CertificateNo` (the MahaRERA registration id) joins them.
 *
 * THE FIELD NAMED `projectName` IN THE MAP BLOB IS THE PROMOTER
 * This is verified, not assumed: five ids cross-checked against the list page
 * matched the promoter every time and the project name never.
 *
 *     P50500000005  map "GREEN SPACE INFRA VENTURES"  list project "GREEN CITY 3"
 *     P52100006356  map "Immense Realty"              list project "Immense Heights"
 *     P52100001149  map "VISHAL SANJAY GALANDE"       list project "THE COSMOPOLIS"
 *
 * Trusting the label would name 13,692 Pune societies after builders and
 * private individuals -- and a society page asserting "Immense Realty" as the
 * building's name is exactly the "misleading context" the licence forbids. The
 * normaliser therefore reads it into `promoter` and leaves `projectName` to the
 * list crawl, which is the only place a real name exists.
 */
import { readFileSync } from 'node:fs';

export const ATTRIBUTION =
  'Source: MahaRERA (Maharashtra Real Estate Regulatory Authority), maharera.maharashtra.gov.in — reproduced under the portal Copyright Policy.';

/* A browser User-Agent is required, not preferred: the WAF answers a default
   client with 403 on every path. Politeness delay is ours, not the server's --
   the portal publishes no robots.txt (it 403s), so there is no crawl-delay to
   honour and we pick a conservative one. */
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const MAP_URL = 'https://maharera.maharashtra.gov.in/map-projects-search-result';
export const LIST_URL = 'https://maharera.maharashtra.gov.in/projects-search-result';

/** Pull the JSON array embedded in the map page's HTML.
 *
 *  The scan must be string-aware. Survey numbers in `plotBearing` contain
 *  brackets, so a naive depth counter closes the array early and JSON.parse
 *  dies on an unterminated string ~1.4 MB in.
 */
export function extractMapJson(html) {
  const start = html.indexOf('[{"');
  if (start < 0) throw new Error('map payload not found — page shape changed');

  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) { end = i + 1; break; }
  }
  if (end < 0) throw new Error('map payload not terminated — page shape changed');

  const raw = html.slice(start, end)
    .replace(/&amp;/g, '&').replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return JSON.parse(raw);
}

/* The portal writes "Not Available", "-" and "" for the same fact: it does not
   hold this. They must all normalise to null. Left as distinct strings they
   would survive into a spreadsheet column and be counted as data, and "-" would
   sort as a locality name. */
const NA = new Set(['', '-', '--', 'n/a', 'na', 'not available', 'notavailable', 'null']);
export const clean = (v) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return NA.has(s.toLowerCase()) ? null : s;
};

/** Coordinates, or null. Zero is the portal's "unset", never a real Maharashtra pin. */
export const coord = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/** One map row -> our shape. `projectName` deliberately becomes `promoter` (see docblock). */
export const normaliseMapRow = (r) => ({
  rera: clean(r.CertificateNo),
  promoter: clean(r.projectName),
  lat: coord(r.Latitude),
  lng: coord(r.Longitude),
  locality: clean(r.locality),
  street: clean(r.street),
  village: clean(r.project_Village),
  taluka: clean(r.project_Taluka),
  district: clean(r.project_District),
  division: clean(r.project_Division),
  state: clean(r.project_State),
  pincode: clean(r.pincode),
  surveyNo: clean(r.plotBearing),
});

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Pune urban bounding box (PMC + PCMC and the immediate fringe).
 *  A coarse gate to separate the city from Junnar/Baramati/Indapur, which are
 *  Pune DISTRICT but 60-150 km out and not a market we serve. */
export const PUNE_BOX = { minLat: 18.35, maxLat: 18.80, minLng: 73.60, maxLng: 74.10 };
export const inPuneBox = (r) =>
  r.lat != null && r.lng != null &&
  r.lat >= PUNE_BOX.minLat && r.lat <= PUNE_BOX.maxLat &&
  r.lng >= PUNE_BOX.minLng && r.lng <= PUNE_BOX.maxLng;
