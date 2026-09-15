/* Check that no spec hand-rolls its own console / page-error listener. What counts as a real console
   error lives once in `helpers/console.js`; a private `page.on('console')` forks that definition and
   the fork drifts — failing on noise nothing else fails on, or passing on noise since ruled a bug.

   Run: npm run check:console   (from e2e/) */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TESTS = 'tests';

/* The single documented exception: it drives a real backend over the corporate network, so it needs
   raw `String(e)` text with response-level attribution. It still composes the shared IGNORE list
   rather than copying it, which is the part this check insists on. */
const ALLOWED = new Map([
  ['property-integration.spec.js', /helpers\/console\.js/],
]);

const LISTENER = /page\.on\(\s*['"](?:console|pageerror)['"]/;

const specs = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.spec.js')) specs.push(full);
  }
})(TESTS);

const offenders = [];
for (const file of specs) {
  const rel = path.relative(TESTS, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const hits = lines
    .map((line, i) => (LISTENER.test(line) ? i + 1 : 0))
    .filter(Boolean);
  if (!hits.length) continue;

  const waiver = ALLOWED.get(path.basename(file));
  if (waiver && waiver.test(src)) continue;
  offenders.push(
    waiver
      ? `${rel}: waived, but no longer imports from helpers/console.js`
      : `${rel}: ${hits.length} local listener(s) at line ${hits.join(', ')}`,
  );
}

console.log(`specs scanned: ${specs.length}   waived: ${ALLOWED.size}`);
if (offenders.length) {
  console.error(`\nLOCAL CONSOLE FILTERS (${offenders.length}) — use trackErrors() from helpers/console.js:`);
  offenders.forEach((o) => console.error('  ' + o));
  process.exitCode = 1;
} else {
  console.log('every spec gets its console-error definition from helpers/console.js.');
}
