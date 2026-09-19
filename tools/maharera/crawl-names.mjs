/* Crawl the MahaRERA list pages for the one field the map payload lacks: the
 * PROJECT NAME (and, as a cross-check, the promoter).
 *
 * WHY A 4,943-PAGE CRAWL IS UNAVOIDABLE
 * Both obvious shortcuts were tested and neither works:
 *   - `project_district` is the real filter parameter, but the <select> is
 *     AJAX-populated and never ships its option values. GET with `Pune` returns
 *     zero rows; POST with a valid form_build_id and session cookie returns the
 *     UNFILTERED first page.
 *   - `items_per_page`, `limit` and `count` are all ignored. Page size is
 *     hard-locked at 10.
 * So: every page, politely, once. Roughly 2.5 hours.
 *
 * RESUMABLE BY CONSTRUCTION
 * Output is JSONL appended per page, and completed page numbers are tracked in
 * a sidecar. A crawl this long will be interrupted -- by a laptop sleeping, a
 * dropped connection, a portal restart -- and restarting from zero each time
 * would mean it never finishes. Re-running skips what landed.
 *
 * Run: node tools/maharera/crawl-names.mjs [--from N] [--to N] [--delay ms]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIST_URL, UA, clean } from './lib.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'maharera');
mkdirSync(OUT, { recursive: true });
const ROWS = join(OUT, 'list-rows.jsonl');
const DONE = join(OUT, 'list-progress.json');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};
const DELAY = arg('delay', 1500);
const FROM = arg('from', 0);
const TO = arg('to', null);

const done = new Set(existsSync(DONE) ? JSON.parse(readFileSync(DONE, 'utf8')).pages : []);
const markDone = (p) => {
  done.add(p);
  writeFileSync(DONE, JSON.stringify({ pages: [...done].sort((a, b) => a - b) }), 'utf8');
};

/* Each result is a `<div class="row shadow …">` card with a stable inner shape:
 *
 *   <p class="p-0"># P52200000566</p>
 *   <h4 class="title4"><strong>ANURON SEVEN</strong></h4>   <- project name
 *   <p class="darkBlue bold ">ANURON INFRASTRUCTURES</p>    <- promoter
 *   … District / Pincode cells … /public/project/view/38
 *
 * Note the `# ` prefix on the registration id: an earlier parser anchored on
 * /^[A-Z]{1,2}\d{8,}$/ and matched nothing on any page, silently producing a
 * zero-row crawl that still exited successfully. District and pincode are read
 * too — not needed for the join, but they let the merge step verify that the
 * two endpoints agree about a row before trusting either.
 */
function parsePage(html) {
  const cards = html.split(/<div class="row shadow/i).slice(1);
  const out = [];

  for (const card of cards) {
    const rera = clean((card.match(/<p class="p-0">\s*#?\s*([A-Z]{1,2}\d{6,})\s*<\/p>/i) || [])[1]);
    const projectName = clean((card.match(/<h4[^>]*class="title4"[^>]*>\s*<strong>([\s\S]*?)<\/strong>/i) || [])[1]);
    const promoter = clean((card.match(/<p class="darkBlue bold[^"]*">([\s\S]*?)<\/p>/i) || [])[1]);
    const viewId = (card.match(/public\/project\/view\/(\d+)/) || [])[1];
    /* Only the join key is mandatory. A filing whose name the portal records as "NA" still has a
       real id, promoter and district, and discarding the whole card for a missing name makes the
       page look short for a reason no later reader can reconstruct. Let the name be null and let
       the consumer decide; a society needs a name, an accounting of filings does not. */
    if (!rera) continue;

    const cell = (label) => clean(
      (card.match(new RegExp(`<div class="greyColor">\\s*${label}\\s*</div>\\s*<p>([\\s\\S]*?)</p>`, 'i')) || [])[1],
    );
    const strip = (s) => (s == null ? null : clean(s.replace(/<[^>]+>/g, ' ')));

    out.push({
      rera,
      viewId: viewId ?? null,
      projectName: strip(projectName),
      promoter: strip(promoter),
      district: cell('District'),
      pincode: cell('Pincode'),
      lastModified: cell('Last Modified'),
    });
  }
  return out;
}

/* The portal answers an overloaded moment with HTTP 200 and a friendly "No Records Found"
   shell (~49 KB against a normal ~114 KB), so status codes cannot detect it and a parser sees
   a legitimately empty page. Left unhandled it cost this crawl ~19 pages: they parsed to zero
   rows, were marked done, and would have been skipped forever on resume. Treat it as the
   transient failure it is, and let the existing backoff retry it. */
const isTransientEmpty = (html) => /No Records Found/i.test(html);

const fetchPage = async (page, tries = 0) => {
  try {
    const res = await fetch(`${LIST_URL}?page=${page}`, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (isTransientEmpty(html)) throw new Error('"No Records Found" (server busy)');
    return html;
  } catch (err) {
    /* Back off and retry rather than abandoning the page: over ~5,000 requests a
       handful of transient failures is certain, and a gap in the middle is worse
       than a slow crawl because the join downstream would silently lose rows. */
    if (tries >= 4) { console.warn(`  page ${page}: giving up (${err.message})`); return null; }
    const wait = 3000 * 2 ** tries;
    console.warn(`  page ${page}: ${err.message} — retry in ${wait / 1000}s`);
    await new Promise((s) => setTimeout(s, wait));
    return fetchPage(page, tries + 1);
  }
};

const first = await fetchPage(FROM);
if (!first) throw new Error('could not fetch the first page');
const totalPages = TO ?? Number((first.match(/of\s*(?:<[^>]*>\s*)*([0-9,]+)/) || [])[1]?.replace(/,/g, '') || 4943);
console.log(`crawling pages ${FROM}..${totalPages} (${done.size} already done), delay ${DELAY}ms`);
console.log(`ETA ~${(((totalPages - FROM - done.size) * (DELAY + 700)) / 3.6e6).toFixed(1)}h`);

let written = 0;
let emptyStreak = 0;
for (let p = FROM; p <= totalPages; p++) {
  if (done.has(p)) continue;
  const html = p === FROM ? first : await fetchPage(p);
  if (html) {
    const rows = parsePage(html);
    if (rows.length) {
      appendFileSync(ROWS, rows.map((r) => JSON.stringify({ ...r, page: p })).join('\n') + '\n', 'utf8');
      written += rows.length;
      emptyStreak = 0;
      /* Only a page that yielded rows is done. Marking an empty one done is how a transient
         failure becomes permanent: resume skips it and the gap is never visible again. */
      markDone(p);
    } else {
      /* Reaching here means a full-size page that is NOT the "No Records Found" shell still
         parsed nothing -- the selector is genuinely broken, which is the case worth stopping
         for. A parser that matches nothing otherwise "succeeds" on every page. */
      if (++emptyStreak >= 5) {
        throw new Error(`5 consecutive full pages parsed to 0 rows (last: ${p}) — markup changed, parser needs updating`);
      }
      console.warn(`  page ${p}: 0 rows from a full page — not marking done`);
    }
    if (p % 25 === 0) console.log(`  page ${p}/${totalPages} — ${written.toLocaleString()} rows this session`);
  }
  await new Promise((s) => setTimeout(s, DELAY));
}
console.log(`done — ${written.toLocaleString()} rows appended to ${ROWS}`);
