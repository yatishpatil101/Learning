/**
 * D208 gate — two assertions that together keep the provider import cycle dead.
 *
 *   1. `services/config.js` globs the providers **lazily**.
 *   2. No provider reads an `http.js` binding at module scope.
 *
 * The shape both exist to catch:
 *
 *   `services/http.js` imports `API_BASE` from `services/config.js`. When `config.js` globs with
 *   `{ eager: true }` it statically imports every provider, and every provider imports `http.js` —
 *   a live cycle. Whenever a page reaches `http.js` first, every provider is evaluated *inside*
 *   `http.js`'s own evaluation, while `http.js`'s `export const` / `export class` bindings are
 *   still in their temporal dead zone. A provider that touches one of them at module scope
 *   therefore throws during bootstrap, before React mounts, and the whole application renders an
 *   empty `<body>` on every route.
 *
 * That happened on 2026-08-11 (`Cannot access 'MAX_PAGE_SIZE' before initialization`, from two
 * providers the failing screens never used) and **every static gate stayed green**: a Vite build
 * resolves the cycle happily, ESLint has no opinion about evaluation order across modules, and the
 * bundle is byte-for-byte fine. Only a browser executes it. So this check is deliberately not a
 * lint rule — it is a bespoke assertion about one known-dangerous edge.
 *
 * **2026-08-12: the glob is now lazy and the cycle is gone.** `config.js` no longer imports a
 * provider at all, so the static graph is a DAG and a provider body cannot run before `http.js` has
 * finished — which is what check (1) now protects, and it is the load-bearing one. Check (2) is
 * kept rather than deleted because it costs nothing, because it is the only thing that would still
 * fire if someone reinstates `{ eager: true }` *and* the message it prints names the offending
 * file and line, and because the failure it describes is invisible to every other tool we own.
 * Neither check replaces the boot canary (`e2e/tests/platform/boot-canary.spec.js`): D208's
 * standing rule is that one e2e spec must actually render a page before a frontend wave is called
 * verified.
 *
 * What check (2) flags: any identifier imported from `services/http.js` (however the path is
 * spelled) that is *referenced* outside every function, arrow and class body in a file under
 * `src/services/providers/**`.
 *
 * Parsing is a real AST walk (espree, already present as ESLint's parser) rather than a regex: the
 * whole question is *where* an identifier sits in the tree, which is exactly what a regex cannot
 * see. It would either miss `const x = { a: { b: MAX_PAGE_SIZE } }` or fire on the same text inside
 * a function.
 *
 * Constants that providers legitimately need at module scope belong in `services/apiLimits.js`,
 * which imports nothing and is therefore outside any cycle a future edit could reintroduce.
 *
 * Exit code 1 on any finding. Wired into `npm run check`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'espree';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROVIDER_ROOT = join(ROOT, 'src', 'services', 'providers');
const HTTP_MODULE = join(ROOT, 'src', 'services', 'http.js');
const CONFIG_MODULE = join(ROOT, 'src', 'services', 'config.js');

/** Every `.js` under `src/services/providers/**`, in a stable order. */
function collect(dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * True when `spec` resolves to `services/http.js` from `file`.
 *
 * Resolved rather than string-matched so `../../http.js`, `../../../services/http.js` and any
 * future alias all land on the same answer — the gate must not be defeatable by rewriting the path.
 */
const isHttpImport = (spec, file) =>
  spec.startsWith('.') && resolve(dirname(file), spec) === HTTP_MODULE;

/**
 * Shapes whose bodies *can* run later than module evaluation. Whether they actually do is
 * {@link isDeferred}'s call — a function that is invoked on the spot defers nothing.
 *
 * Classes are deliberately absent. A `static` field initializer and a `static {}` block execute
 * when the class declaration is *evaluated*, i.e. at module scope, so skipping `ClassDeclaration`
 * wholesale waved through `class Q { static page = { size: MAX_PAGE_SIZE }; }` — which crashes
 * exactly like the 2026-08-11 incident. The walk descends into classes instead and skips only the
 * parts that genuinely run later.
 */
const DEFERRED = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/**
 * True when `node`'s body really does run after module evaluation.
 *
 * An immediately-invoked function does not: `const paged = (() => ({ size: MAX_PAGE_SIZE }))();`
 * runs now. That form is one character away from the fix this gate itself recommends, so treating
 * every arrow as safe would wave through the mistake a reader is *most* likely to make while
 * tidying — a green gate and a blank page.
 */
const isDeferred = (node, parent, key) =>
  DEFERRED.has(node.type)
  && !((parent?.type === 'CallExpression' || parent?.type === 'NewExpression') && key === 'callee');

/**
 * Walk `node`, calling `onIdentifier` for every identifier *reference* that is still at module
 * scope. Descent stops at any node {@link isDeferred} vouches for.
 *
 * Class members are split rather than skipped: a computed key and a `static` field initializer are
 * evaluated with the class, so they are walked; method bodies are not. An *instance* field
 * initializer runs at construction, so it is skipped — the residual gap is a class that both
 * declares one and is instantiated at module scope, which nothing in `providers/` does.
 *
 * Skipped as non-references: import/export specifiers (a binding, not a read), the property of a
 * non-computed member expression (`res.MAX_PAGE_SIZE`), a non-computed object/class key, and the
 * declared name of a class, variable or label.
 */
function walkModuleScope(node, onIdentifier, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return;
  if (isDeferred(node, parent, key)) return;
  if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') return;
  if (node.type === 'ExportNamedDeclaration' && node.source) return;

  if (node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') {
    walkModuleScope(node.key, onIdentifier, node, 'key');
    if (node.type === 'PropertyDefinition' && node.static) {
      walkModuleScope(node.value, onIdentifier, node, 'value');
    }
    return;
  }

  if (node.type === 'Identifier') {
    const isMemberProperty = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed;
    const isPropertyKey =
      (parent?.type === 'Property' || parent?.type === 'PropertyDefinition' || parent?.type === 'MethodDefinition')
      && key === 'key'
      && !parent.computed;
    const isDeclaredName =
      (parent?.type === 'VariableDeclarator' && key === 'id')
      || ((parent?.type === 'ClassDeclaration' || parent?.type === 'ClassExpression') && key === 'id')
      || (parent?.type === 'ExportSpecifier')
      || (parent?.type === 'ImportSpecifier')
      || (parent?.type === 'LabeledStatement');
    if (!isMemberProperty && !isPropertyKey && !isDeclaredName) onIdentifier(node);
    return;
  }

  for (const [childKey, child] of Object.entries(node)) {
    if (childKey === 'parent' || childKey === 'loc' || childKey === 'range') continue;
    if (Array.isArray(child)) child.forEach((c) => walkModuleScope(c, onIdentifier, node, childKey));
    else if (child && typeof child === 'object') walkModuleScope(child, onIdentifier, node, childKey);
  }
}

const failures = [];
let scanned = 0;

/* Check (1): the glob stays lazy.
 *
 * Matched on source text rather than the AST because `import.meta.glob` is a Vite compile-time
 * macro, not a call espree can resolve — what matters is literally whether the second argument
 * says `eager: true`, and that is a textual fact about a line this file's whole premise rests on.
 * `{ eager: false }` is spelled the same as omitting it, so only `true` is rejected. */
const configSource = readFileSync(CONFIG_MODULE, 'utf8');
const globCalls = [...configSource.matchAll(/import\.meta\.glob\((.*?)\)/gs)];
if (globCalls.length === 0) {
  failures.push('src/services/config.js: no `import.meta.glob(...)` found — this gate cannot vouch for it.');
}
for (const call of globCalls) {
  if (!/\beager\s*:\s*true\b/.test(call[1])) continue;
  const line = configSource.slice(0, call.index).split('\n').length;
  failures.push(
    `src/services/config.js:${line} globs the providers with \`eager: true\`, which reinstates the `
      + 'http.js -> config.js -> providers -> http.js import cycle.',
  );
}

// Check (2): no module-scope read of an `http.js` export in any provider.
for (const file of collect(PROVIDER_ROOT)) {
  const source = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      loc: true,
      ecmaFeatures: { jsx: true },
    });
  } catch (err) {
    // A file this gate cannot parse is a file it cannot vouch for — that is a failure, not a skip.
    failures.push(`${relative(ROOT, file)}: could not be parsed (${err.message})`);
    continue;
  }
  scanned += 1;

  /** local name → name as exported by `http.js` */
  const imported = new Map();
  for (const stmt of ast.body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    if (!isHttpImport(stmt.source.value, file)) continue;
    for (const spec of stmt.specifiers) {
      const source_ = spec.imported?.name ?? (spec.type === 'ImportDefaultSpecifier' ? 'default' : '*');
      imported.set(spec.local.name, source_);
    }
  }
  if (imported.size === 0) continue;

  walkModuleScope(ast, (id) => {
    if (!imported.has(id.name)) return;
    failures.push(
      `${relative(ROOT, file)}:${id.loc.start.line}:${id.loc.start.column + 1} reads `
        + `\`${id.name}\` (imported from services/http.js) at module scope.`,
    );
  });
}

if (failures.length) {
  console.error('\nProvider/http.js import-cycle check FAILED\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(
    '\n  Why this is fatal: with an eager glob, `http.js` imports `config.js`, `config.js` imports\n'
      + '  every provider, and every provider imports `http.js`. A provider is therefore sometimes\n'
      + "  evaluated *inside* `http.js`, while its exports are still in their temporal dead zone. A\n"
      + '  module-scope read throws during bootstrap and blanks the entire app on every route — with\n'
      + '  lint, build and bundle-size all green, because only a browser executes the cycle.\n'
      + '\n  Fix, in order of preference:\n'
      + '    0. Keep the glob in `config.js` lazy. That is what removes the cycle; the rest are\n'
      + '       mitigations for a cycle that should not exist.\n'
      + '    1. If it is a constant, move it to `src/services/apiLimits.js` (which imports nothing,\n'
      + '       so it is always evaluated first) and import it from there.\n'
      + '    2. Otherwise defer the read to call time — `const paged = () => ({ size: MAX_PAGE_SIZE })`\n'
      + '       rather than `const paged = { size: MAX_PAGE_SIZE }`.\n'
      + '\n  See tech-debt D208.\n',
  );
  process.exit(1);
}

console.log(
  `✓ provider/http.js cycle check: config.js globs lazily; ${scanned} provider modules, `
    + 'no module-scope reads.',
);
