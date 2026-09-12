/* Critical-path size gate.
 *
 * ~80% of Draazy traffic is expected on phones, mostly on Indian 4G, where the
 * bytes that must arrive *before first paint* decide whether a visitor waits. Vite
 * only warns about large chunks, and a warning in a 200-line build log is a warning
 * nobody reads — this fails the build instead.
 *
 * What counts as critical is not guessed from filenames: it is read out of the
 * emitted dist/index.html, so the gate measures exactly what the browser is told to
 * fetch before it can render — the entry <script type="module">, every
 * <link rel="modulepreload">, and every <link rel="stylesheet">. A first attempt
 * matched `index-*.js` by prefix and silently caught an unrelated vendor chunk that
 * also happened to be named index; parsing the document has no such ambiguity and
 * needs no maintenance when the chunking changes.
 *
 * Lazy route chunks are deliberately not counted. Splitting work *into* them is the
 * behaviour we want, and budgeting them would penalise it.
 *
 * Gzip, not raw: gzip is what crosses the wire.
 *
 * BUDGET_KB is a ratchet, not an aspiration — set just above the measured size at
 * the time of writing so the gate is green today and any regression fails loudly.
 * A budget that is never tightened is a budget that has stopped working.
 *
 * It has been raised twice now, and the reason is worth writing down because it is
 * not "the app got bigger". Route chunks are already lazy — every page in App.jsx is
 * behind `lazy(() => import(...))` — so shipping a new *page* costs the critical path
 * nothing. What it does cost is a new `locales/en/<ns>.json`, because i18n/index.js
 * merges all twenty English namespaces eagerly into one `translation` bundle. English
 * is 250 KB raw of which `services.json` (60 KB), `property.json` (29 KB),
 * `list-property.json` (23 KB) and `flatmates.json` (20 KB) are read by exactly one
 * route family each. So the critical path grows with every feature *regardless* of
 * how well the feature is split, and this gate will keep going red on work that did
 * nothing wrong. That is the thing to fix — not the number below.
 *
 * Lowered 595 → 540 after debt wave 10 measured 536.3 KB. The gap it was carrying was
 * slack from a raise that anticipated growth which then did not arrive, and slack is
 * how a ratchet quietly stops ratcheting: a 59 KB cushion is eleven percent of the
 * critical path, enough to absorb an entire eager namespace without ever going red.
 *
 * Lowered 540 → 497 (D203) once D129's lazy chunks landed and the critical path
 * measured 492.9 KB. 540 had stopped being a gate and become an accident: the two
 * chunks D129 split out are 22.3 KB (db) and 24.8 KB (societies-rera) gzip, so a
 * regression that pulled *both* back onto the critical path totalled 540.1 KB and
 * tripped by 0.07 KB, while either one *alone* landed at 515.2 / 517.7 KB and passed
 * in silence. A budget that can only catch the double failure is not catching the
 * single one. 497 keeps the same deliberately uncomfortable ~4 KB headroom the
 * previous ratchet chose, and either chunk alone now fails by ~18 KB.
 *
 * If this fails on work that did nothing wrong, the fix is to make another eager
 * namespace lazy, not to raise the number again; raising it is only honest when the
 * app genuinely needs to be bigger.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Current ceiling (KB gzip). TARGET is where §2 of the mobile review takes us. */
const BUDGET_KB = 497;
const TARGET_KB = 180;

const DIST = join(process.cwd(), 'dist');
const HTML = join(DIST, 'index.html');

if (!existsSync(HTML)) {
  console.error('✗ dist/index.html not found — run `npm run build` first.');
  process.exit(1);
}

const html = readFileSync(HTML, 'utf8');

/* Same-origin only. A cross-origin <link> (Google Fonts) is real critical-path cost,
   but it is not a file we ship and cannot be measured from disk — it is tracked as
   item A4 in the mobile review instead. */
const local = (re) => [...html.matchAll(re)].map((m) => m[1]).filter((h) => h.startsWith('/'));

const assets = [
  ...local(/<script[^>]+type="module"[^>]+src="([^"]+)"/g),
  ...local(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
  ...local(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g),
];

/* A gate that reports 0 KB because it found nothing is worse than no gate: it would
   wave through every regression while looking green. */
if (assets.length === 0) {
  console.error('✗ No local entry assets found in dist/index.html — the build output shape changed.');
  process.exit(1);
}

let total = 0;
console.log('Critical path (gzip), read from dist/index.html:');
for (const href of assets) {
  const file = join(DIST, href.replace(/^\//, ''));
  if (!existsSync(file)) {
    console.error(`✗ index.html references ${href}, which is missing from dist.`);
    process.exit(1);
  }
  const kb = gzipSync(readFileSync(file)).length / 1024;
  total += kb;
  console.log(`  ${href.padEnd(46)} ${kb.toFixed(1).padStart(7)} KB`);
}

console.log(`  ${'TOTAL'.padEnd(46)} ${total.toFixed(1).padStart(7)} KB   (budget ${BUDGET_KB}, target ${TARGET_KB})`);

if (total > BUDGET_KB) {
  console.error(
    `\n✗ Critical path is ${(total - BUDGET_KB).toFixed(1)} KB over budget.\n` +
    '  Move the new weight into a lazy route chunk, or raise BUDGET_KB in this file\n' +
    '  deliberately — in a commit message someone can find later.',
  );
  process.exit(1);
}

console.log('\n✓ Within budget.');
