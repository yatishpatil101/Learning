/**
 * Keeps `lib/telemetry/routePatterns.js` in step with `App.jsx`.
 *
 * The telemetry beacon reduces every URL to a route *pattern* before sending it, because
 * `/property/kothrud-3bhk-lakeview-9f2c` is a browsing history and `/property/:id` is a page-views
 * chart. Matching is done against an enumerated list rather than a heuristic, for the reason
 * `routePatterns.js` gives: `/services/packers-movers` and `/property/kothrud-3bhk` are
 * structurally identical strings, so no rule about slug-shaped segments can tell a static page from
 * a listing.
 *
 * That leaves a duplicated list, and this script is the only thing stopping it rotting. **The
 * failure it prevents is silent.** A route added to `App.jsx` and not added there does not error,
 * does not warn, and does not break a page: `matchRoutes` simply returns no match, the view is
 * filed under `/*` — the 404 bucket — and the new page reports zero traffic forever while the
 * "broken links" number quietly climbs. Nobody looks at a chart and infers a missing array entry.
 * The one moment that mistake is cheap to catch is the commit that adds the route.
 *
 * Parsing is a regex over `path=` literals rather than an AST walk, and that is a deliberate step
 * down from `check-provider-cycle.mjs`. The question here is textual — which paths does `App.jsx`
 * declare — and all but one group of them are plain string literals on a `<Route>` element in that
 * one file.
 *
 * The exception is the help centre, which is registered three times over by mapping the route block
 * across `['', '/hi', '/mr']` so each language gets its own indexable URL. Those six paths are
 * template literals, so the script expands them against the prefix array it reads from the same
 * `.map(` call. Any *other* expression form is a hard failure rather than a skip: silently seeing
 * less of the route table while still reporting "no drift" is a worse outcome than the drift this
 * was written to catch. On the day it was added the bail-out fired immediately and found all
 * eighteen help routes missing — the entire public help centre had been filed as 404 traffic.
 *
 * Exit code 1 on any drift. Wired into `npm run check`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'src', 'App.jsx');
const PATTERNS = join(ROOT, 'src', 'lib', 'telemetry', 'routePatterns.js');

const app = readFileSync(APP, 'utf8');

/**
 * The prefixes the help routes are registered under, read from the `.map(` that registers them.
 *
 * Read rather than hardcoded so that adding a fourth language to `App.jsx` extends this check
 * automatically instead of quietly leaving that language's help articles uncounted.
 */
const prefixBlock = app.match(/\[([^\]]*)\]\.map\(\(prefix\)/);
const prefixes = prefixBlock
  ? [...prefixBlock[1].matchAll(/'([^']*)'/g)].map((m) => m[1])
  : null;

/**
 * `path={...}` route paths.
 *
 * Exactly one shape is understood: a template literal opening with `${prefix}`, which is how the
 * help centre is registered once per language. Anything else means the script can no longer see the
 * whole route table, and a check that has gone partially blind must fail rather than report
 * success — so the understood shapes are counted and compared against every `path={` in the file.
 */
const expanded = [];
let understood = 0;
for (const match of app.matchAll(/path=\{`([^`]*)`\}/g)) {
  const template = match[1].match(/^\$\{prefix\}(.*)$/);
  if (!template || !prefixes) continue;
  understood += 1;
  for (const prefix of prefixes) expanded.push(`${prefix}${template[1]}`);
}

const computed = (app.match(/path=\{/g) || []).length;
if (computed !== understood) {
  console.error(
    `check-route-patterns: App.jsx declares ${computed - understood} route path(s) in a form ` +
      'this script cannot evaluate.\n\n' +
      'Its "no drift" result would be meaningless while it cannot see them. Either keep route ' +
      'paths as string literals, teach this script the new shape, or replace the regex with an ' +
      'AST walk (see check-provider-cycle.mjs for the pattern).',
  );
  process.exit(1);
}

/** Every route path App.jsx declares, minus the `*` catch-all, which `UNMATCHED` stands for. */
const declared = new Set(
  [...app.matchAll(/path="([^"]+)"/g)]
    .map((m) => m[1])
    .concat(expanded)
    .filter((p) => p !== '*'),
);

/**
 * The `ROUTE_PATTERNS` array, read as text.
 *
 * Importing the module instead would drag in `react-router` and turn a hundred-millisecond check
 * into a bundler's problem for no gain — the array is a list of string literals either way.
 */
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
/*
 * Comments are stripped before the literals are read.
 *
 * Not defensive tidying: the array carries explanatory comments, and on the day this script was
 * written one of them contained a quoted example. The quote scanner paired that quote with the
 * next real entry's opening quote, desynchronised every pair after it, and reported sixty-eight
 * present routes as missing plus four comment fragments as stale. A comment must not be able to
 * change what the code below believes the code above says.
 */
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
