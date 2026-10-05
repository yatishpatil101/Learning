/* Missing route namespaces render raw keys without throwing, so this catches silent i18n drift. */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = resolve(process.cwd(), 'src');
const LOCALES_EN = join(SRC, 'i18n', 'locales', 'en');
const APP = join(SRC, 'App.jsx');

const { EAGER_NAMESPACES } = await import(pathToFileURL(join(SRC, 'i18n', 'namespaces.js')).href);
const EAGER = new Set(EAGER_NAMESPACES);

const keyToNs = new Map();
for (const file of readdirSync(LOCALES_EN).filter((f) => f.endsWith('.json'))) {
  const ns = file.replace(/\.json$/, '');
  const walk = (node, path) => {
    for (const [k, v] of Object.entries(node)) {
      const full = path ? `${path}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, full);
      else keyToNs.set(full, ns);
    }
  };
  walk(JSON.parse(readFileSync(join(LOCALES_EN, file), 'utf8')), '');
}
const allKeys = [...keyToNs.keys()];

/** Two eager files must not share a top-level prefix: the eager merge is a shallow Object.assign, so one would
 * silently erase the other. */
const eagerPrefixOwner = new Map();
for (const [key, ns] of keyToNs) {
  if (!EAGER.has(ns)) continue;
  const prefix = key.split('.')[0];
  const owner = eagerPrefixOwner.get(prefix);
  if (owner && owner !== ns) {
    console.error(`✗ Eager namespaces ${owner}.json and ${ns}.json both define "${prefix}.*".`);
    console.error('  The eager merge is shallow (Object.assign), so one silently erases the other.');
    process.exit(1);
  }
  eagerPrefixOwner.set(prefix, ns);
}

/** Namespace for a string literal: an exact key, or a prefix of one (keys are
 *  built at runtime in places — `i18n.t('misc.cat_' + k)` in lib/data/support.js). */
const literalCache = new Map();
function nsForLiteral(literal) {
  if (literalCache.has(literal)) return literalCache.get(literal);
  let ns = keyToNs.get(literal);
  if (!ns) {
    const partial = allKeys.find((k) => k.startsWith(literal));
    ns = partial ? keyToNs.get(partial) : undefined;
  }
  literalCache.set(literal, ns);
  return ns;
}

/* ── 2. import-graph walk ── */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, join(base, 'index.js'), join(base, 'index.jsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const KEY_LITERAL = /['"`]([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)['"`]/g;
const IMPORT_SPEC = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

/* Per-file facts, read once. Recomputing these per route turned a linear walk
   into a quadratic one and the script stopped finishing. */
const fileFacts = new Map();
function factsFor(file) {
  let facts = fileFacts.get(file);
  if (facts) return facts;
  facts = { direct: new Set(), imports: [] };
  fileFacts.set(file, facts);

  // i18n's own modules reference every namespace by construction.
  if (file.includes(join('src', 'i18n'))) return facts;

  let source;
  try { source = readFileSync(file, 'utf8'); } catch { return facts; }

  /** Strip comments before scanning: comment text must not spoof route code. */
  source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  for (const [, literal] of source.matchAll(KEY_LITERAL)) {
    const ns = nsForLiteral(literal);
    if (ns) facts.direct.add(ns);
  }
  for (const [, spec] of source.matchAll(IMPORT_SPEC)) {
    const resolved = resolveImport(file, spec);
    if (resolved) facts.imports.push(resolved);
  }
  return facts;
}

/** Namespaces reachable from `file` through static/dynamic local imports. */
function namespacesReachedBy(file) {
  const found = new Set();
  if (!file) return found;
  const seen = new Set([file]);
  const queue = [file];
  while (queue.length) {
    const facts = factsFor(queue.pop());
    for (const ns of facts.direct) found.add(ns);
    for (const next of facts.imports) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return found;
}

/* ── 3. routes ── */
const app = readFileSync(APP, 'utf8');
const ROUTE = /const (\w+) = lazyPage\(\(\) => import\('([^']+)'\)(?:,\s*([^)]*))?\);/g;
const PLAIN_LAZY = /const (\w+) = lazy\(\(\) => import\('([^']+)'\)\);/g;

let failures = 0;
const hints = [];

for (const [, name, spec, argsRaw] of app.matchAll(ROUTE)) {
  const declared = new Set(
    (argsRaw || '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean),
  );
  const required = namespacesReachedBy(resolveImport(APP, spec));
  const missing = [...required].filter((ns) => !declared.has(ns) && !EAGER.has(ns)).sort();
  const spare = [...declared].filter((ns) => !required.has(ns)).sort();
  if (missing.length) {
    console.error(`✗ ${name} (${spec}) reaches ${missing.join(', ')} but does not declare it.`);
    console.error(`  Add it: lazyPage(() => import('${spec}'), ${[...declared, ...missing].sort().map((n) => `'${n}'`).join(', ')});`);
    failures++;
  }
  if (spare.length) hints.push(`  ${name}: declares ${spare.join(', ')} with no static reference`);
}

for (const [, name, spec] of app.matchAll(PLAIN_LAZY)) {
  const required = [...namespacesReachedBy(resolveImport(APP, spec))].filter((ns) => !EAGER.has(ns)).sort();
  if (required.length) {
    console.error(`✗ ${name} (${spec}) uses plain lazy() but needs ${required.join(', ')}.`);
    console.error('  Use lazyPage() so the namespaces load inside the same Suspense boundary.');
    failures++;
  }
}

/* ── 4. the shell renders outside every route boundary ── */
const SYNC_IMPORT = /^import\s+(?:\w+|\{[^}]*\})\s+from\s+'(\.[^']+\.jsx?)';$/gm;
for (const [, spec] of app.matchAll(SYNC_IMPORT)) {
  const file = resolveImport(APP, spec);
  const required = [...namespacesReachedBy(file)].filter((ns) => !EAGER.has(ns)).sort();
  if (required.length) {
    console.error(`✗ ${spec} is imported synchronously by App.jsx but reaches ${required.join(', ')},`);
    console.error('  which is not eager. It renders outside every route boundary, so those keys');
    console.error('  would paint raw. Either make the namespace eager or move the module behind a route.');
    failures++;
  }
}

/* ── 5. the eager list and the eager imports are the same list ── */
const i18nIndex = readFileSync(join(SRC, 'i18n', 'index.js'), 'utf8');
const imported = new Set(
  [...i18nIndex.matchAll(/from '\.\/locales\/en\/([^']+)\.json'/g)].map(([, ns]) => ns),
);
const onlyDeclared = [...EAGER].filter((ns) => !imported.has(ns)).sort();
const onlyImported = [...imported].filter((ns) => !EAGER.has(ns)).sort();
if (onlyDeclared.length || onlyImported.length) {
  console.error('✗ i18n/namespaces.js and i18n/index.js disagree about what is eager.');
  if (onlyDeclared.length) console.error(`  Declared but not imported: ${onlyDeclared.join(', ')}`);
  if (onlyImported.length) console.error(`  Imported but not declared: ${onlyImported.join(', ')}`);
  failures++;
}

if (hints.length && process.env.I18N_NS_HINTS) {
  console.log('Possibly over-declared (static walk only — verify before deleting):');
  for (const h of hints) console.log(h);
}

if (failures) {
  console.error(`\n✗ ${failures} route/namespace mismatch(es).`);
  process.exit(1);
}
console.log(`✓ Route locale namespaces are declared correctly (eager: ${[...EAGER].sort().join(', ')}).`);
