/* Telemetry sends route patterns, not concrete URLs, so page views cannot become browsing history. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'src', 'App.jsx');
const PATTERNS = join(ROOT, 'src', 'lib', 'telemetry', 'routePatterns.js');

const app = readFileSync(APP, 'utf8');

/* Any `path={...}` expression is a hard failure rather than a skip: silently seeing less of the
   route table while still reporting "no drift" is worse than the drift this was written to catch. */
const computed = (app.match(/path=\{/g) || []).length;
if (computed > 0) {
  console.error(
    `check-route-patterns: App.jsx declares ${computed} route path(s) in a form ` +
      'this script cannot evaluate.\n\n' +
      'Its "no drift" result would be meaningless while it cannot see them. Either keep route ' +
      'paths as string literals, or replace the regex with an AST walk (see ' +
      'check-provider-cycle.mjs for the pattern).',
  );
  process.exit(1);
}

/** Every route path App.jsx declares, minus the `*` catch-all, which `UNMATCHED` stands for. */
const declared = new Set(
  [...app.matchAll(/path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p !== '*'),
);

/* Read the source directly; importing it would drag React Router into a string-literal check. */
const source = readFileSync(PATTERNS, 'utf8');
const block = source.match(/export const ROUTE_PATTERNS\s*=\s*\[([\s\S]*?)\];/);
if (!block) {
  console.error(
    'check-route-patterns: could not find `export const ROUTE_PATTERNS = [...]` in ' +
      'src/lib/telemetry/routePatterns.js. If it was renamed or reshaped, update this script — ' +
      'a check that cannot find what it checks must fail, not pass.',
  );
  process.exit(1);
}
/* Strip comments before parsing; a comment quote must not desynchronise route pairs. */
const body = block[1]
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
const known = new Set([...body.matchAll(/'([^']+)'/g)].map((m) => m[1]));

const missing = [...declared].filter((p) => !known.has(p)).sort();
const stale = [...known].filter((p) => !declared.has(p)).sort();

if (missing.length === 0 && stale.length === 0) {
  console.log(`check-route-patterns: ok (${declared.size} routes)`);
  process.exit(0);
}

const bullets = (items) => items.map((i) => `  - ${i}`).join('\n');

if (missing.length > 0) {
  console.error(
    `\ncheck-route-patterns: ${missing.length} route(s) in App.jsx are missing from ` +
      'ROUTE_PATTERNS:\n' +
      `${bullets(missing)}\n\n` +
      'Views of these pages are currently being filed under the 404 bucket, so each one reports ' +
      'zero traffic while inflating the broken-link count. Add them to ' +
      'src/lib/telemetry/routePatterns.js.',
  );
}

if (stale.length > 0) {
  console.error(
    `\ncheck-route-patterns: ${stale.length} pattern(s) in ROUTE_PATTERNS no longer exist in ` +
      'App.jsx:\n' +
      `${bullets(stale)}\n\n` +
      'Harmless to collection, but they are dead entries that make the list look maintained when ' +
      'it is not. Remove them, or restore the route if it went by accident.',
  );
}

process.exit(1);
