/* Check that every spec path cited in COVERAGE.md actually exists.
 *
 * The matrix is only useful if its citations are real; a stale name reads as
 * coverage that is not there. Worth re-running whenever specs move or are added.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TESTS = 'tests';

const have = new Set();
const dirs = new Set();
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      dirs.add(path.relative(TESTS, full).replace(/\\/g, '/'));
      walk(full);
    } else if (entry.name.endsWith('.spec.js')) {
      have.add(path.relative(TESTS, full).replace(/\\/g, '/').replace(/\.spec\.js$/, ''));
    }
  }
})(TESTS);

const doc = readFileSync('COVERAGE.md', 'utf8');

/* Cited spec paths look like `consumer/home/featured`. Anchor on the real
   top-level test folders, and reject anything preceded by a slash: without both
   guards, app routes (`/admin/team`, `/services/rent-agreement`), source paths
   (`lib/chrome`) and plain prose ("role/flag/team") all read as citations. */
const ROOTS = new Set(readdirSync(TESTS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
const cited = new Set();
for (const [, name] of doc.matchAll(/(?<![/\w-])([a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+(?:\/?\*+|-\*)?)/g)) {
  if (ROOTS.has(name.split('/')[0])) cited.add(name);
}

const missing = [...cited].filter((n) => {
  // A trailing `-*` or `/**` is a deliberate glob — satisfied by any matching spec.
  if (n.endsWith('*')) {
    const prefix = n.replace(/\/?\*+$/, '');
    return ![...have].some((h) => h === prefix || h.startsWith(prefix));
  }
  // The folder-summary table names folders rather than specs; both are real.
  return !have.has(n) && !dirs.has(n);
}).sort();

/* Second pass: bare citations, which the scan above cannot see.
 *
 * Many specs are cited without their folder (`live-my-rental`, `maker-checker`, `emi-calculator`),
 * and the path regex requires at least one slash — so a *bare* citation was never validated at
 * all. That is not a theoretical hole: `pay-rent` was deleted in D256 and this script kept
 * reporting "every cited spec path exists", which is the precise failure a citation checker
 * exists to prevent. A gate that answers green on a question it never asked is worse than no
 * gate, because the doc's header promises it did ask.
 *
 * Two things make this pass tolerable rather than noisy. It is scoped to the **spec column** —
 * the last-but-one cell of a status row — because bare names cannot be told from prose anywhere
 * else ("saved", "refer" and "finance" are all ordinary English in this document). And within
 * that cell everything from the first prose marker onward is discarded, since citations lead and
 * commentary follows: `live-listing-entitlements ("taking a listing down frees its slot")` is one
 * citation, not a citation plus four words. A bare name resolves against spec *basenames*, which
 * is what the doc's own convention means by it.
 */
const basenames = new Set([...have].map((h) => h.split('/').pop()));
const STATUS = /^(✅|🟡|❌|⚠️|⬜)/u;
const bareMissing = new Set();
for (const line of doc.split('\n')) {
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').map((c) => c.trim());
  // `split` leaves an empty cell either side of the row's outer pipes.
  if (!STATUS.test(cells[cells.length - 2] || '')) continue;
  const specCell = (cells[cells.length - 3] || '').split(/[(—–"*`:]/)[0];
  for (const part of specCell.split(',')) {
    const token = part.trim().split(/\s+/)[0];
    if (!/^[a-z][a-z0-9-]*$/.test(token)) continue; // bare only; paths are covered above
    if (token === 'backend') continue; // `backend `OtpService`` cites a JUnit class, not a spec
    if (!basenames.has(token) && !have.has(token) && !dirs.has(token)) bareMissing.add(token);
  }
}

console.log(`cited: ${cited.size}   on disk: ${have.size}`);
if (missing.length || bareMissing.size) {
  if (missing.length) {
    console.error(`\nCITED BUT MISSING (${missing.length}):`);
    missing.forEach((m) => console.error('  ' + m));
  }
  if (bareMissing.size) {
    console.error(`\nCITED BUT MISSING — bare names in the spec column (${bareMissing.size}):`);
    [...bareMissing].sort().forEach((m) => console.error('  ' + m));
  }
  process.exitCode = 1;
} else {
  console.log('every cited spec path exists.');
}
