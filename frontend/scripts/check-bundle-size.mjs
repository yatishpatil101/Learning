/* Critical-path size gate.
 *
 * ~80% of PuneNest traffic is expected on phones, mostly on Indian 4G, where the
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
 * Lower it as docs/roadmap/mobile-ux-review.md §2 lands; a budget that is never
 * tightened is a budget that has stopped working.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Current ceiling (KB gzip). TARGET is where §2 of the mobile review takes us. */
const BUDGET_KB = 560;
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
