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

console.log(`cited: ${cited.size}   on disk: ${have.size}`);
if (missing.length) {
  console.error(`\nCITED BUT MISSING (${missing.length}):`);
  missing.forEach((m) => console.error('  ' + m));
  process.exitCode = 1;
} else {
  console.log('every cited spec path exists.');
}
