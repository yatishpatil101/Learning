/* Check that no spec hand-rolls its own console / page-error listener.
 *
 * What "a real console error" means lives in one place, `helpers/console.js`, and
 * specs get it by calling `trackErrors(page)`. A spec that registers its own
 * `page.on('console')` or `page.on('pageerror')` forks that definition, and the
 * fork is worse than having no filter at all: the shared list gains an exemption,
 * the copy does not, and the spec starts failing on noise nothing else fails on —
 * or keeps passing on noise the shared filter has since decided is a real bug.
 * That drift is tech-debt D96, and this gate is what stops it coming back.
 *
 * Run: npm run check:console   (from e2e/)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TESTS = 'tests';

/* The single documented exception. This spec drives a real backend over the
   corporate network, so it needs the raw `String(e)` text paired with
   response-level attribution rather than the shared helper's origin heuristic —
   the reasoning is written out at its own listeners. It does still compose the
   shared IGNORE list rather than copying it, which is the part that matters here,
   so the check below insists on that import instead of waving the file through. */
const ALLOWED = new Map([
  ['live-property-integration.spec.js', /helpers\/console\.js/],
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
