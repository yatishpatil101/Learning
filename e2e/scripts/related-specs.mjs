import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NO_BACKEND } from '../no-backend-specs.js';

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.dirname(E2E_DIR);
const FE = 'frontend/src';
const APP = `${FE}/App.jsx`;
const SHELL = new Set([APP, `${FE}/main.jsx`]);
const BE = 'backend/src/main/java/com/draazy/api';
const ROUTES_JAVA = `${BE}/common/web/Routes.java`;
const CANARY = 'e2e/tests/platform/boot-canary.spec.js';
const NAV_PLUMBING = new Set(['e2e/helpers/liveAuth.js', 'e2e/helpers/auth.js']);
const AUTH_PAGES = new Set([`${FE}/pages/consumer/Signin.jsx`, `${FE}/pages/consumer/StaffLogin.jsx`]);
const E2E_FULL = new Set([
  'e2e/playwright.config.js',
  'e2e/playwright.nobackend.config.js',
  'e2e/global-setup.live.js',
  'e2e/no-backend-specs.js',
  'e2e/package.json',
  'e2e/package-lock.json',
  'e2e/scripts/reset-e2e-db.sql',
  'e2e/scripts/check-seed-coverage.mjs',
]);
const FULL_BACKEND_MODULES = new Set(['common', 'security', 'provider']);

const posix = (p) => p.split(path.sep).join('/');
const abs = (rel) => path.join(REPO, ...rel.split('/'));
const read = (rel) => readFileSync(abs(rel), 'utf8');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const stripJavaComments = (s) => s.replace(/("(?:[^"\\\n]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str ?? '');

function walk(dirRel, keep) {
  const out = [];
  const visit = (d) => {
    for (const e of readdirSync(abs(d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') visit(p);
      } else if (keep(e.name)) out.push(p);
    }
  };
  if (existsSync(abs(dirRel))) visit(dirRel);
  return out;
}

function addTo(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function parseArgs(argv) {
  const opts = { base: 'HEAD', json: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') opts.base = argv[++i];
    else if (argv[i] === '--json') opts.json = true;
    else opts.files.push(...argv[i].split(',').filter(Boolean));
  }
  opts.files = opts.files.map((f) => posix(path.relative(REPO, path.resolve(REPO, f))));
  return opts;
}

function gitChanged(base) {
  const git = (...args) =>
    execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  return [...new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')])];
}

const IMPORT = /(?:import|export)\s+(?:[^'"`;]*?\sfrom\s*)?['"]([^'"\n]+)['"]|import\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const GLOB = /import\.meta\.glob\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g;
const RESOLVE_EXT = ['', '.js', '.jsx', '.mjs', '.ts', '.tsx', '/index.js', '/index.jsx'];

function frontendGraph() {
  const files = walk(FE, (n) => /\.(jsx?|mjs|tsx?|json|css)$/.test(n));
  const known = new Set(files);
  const resolve = (from, spec) => {
    const clean = spec.split('?')[0];
    if (!clean.startsWith('.') && !clean.startsWith('/')) return null;
    const base = clean.startsWith('/')
      ? path.posix.join('frontend', clean)
      : path.posix.join(path.posix.dirname(from), clean);
    return RESOLVE_EXT.map((e) => base + e).find((c) => known.has(c)) ?? null;
  };
  const globFiles = (from, pattern) => {
    const p = path.posix.join(path.posix.dirname(from), pattern);
    const re = new RegExp(`^${escapeRe(p).replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*')}$`);
    return files.filter((f) => re.test(f));
  };

  const importers = new Map();
  for (const f of files) {
    if (!/\.(jsx?|mjs|tsx?)$/.test(f)) continue;
    const text = read(f);
    const deps = new Set();
    for (const m of text.matchAll(IMPORT)) {
      const r = resolve(f, m[1] ?? m[2]);
      if (r) deps.add(r);
    }
    if (f !== `${FE}/services/config.js`) {
      for (const m of text.matchAll(GLOB)) {
        const pats = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
        const excluded = new Set(pats.filter((p) => p.startsWith('!')).flatMap((p) => globFiles(f, p.slice(1))));
        for (const p of pats.filter((x) => !x.startsWith('!'))) {
          for (const g of globFiles(f, p)) if (!excluded.has(g)) deps.add(g);
        }
      }
    }
    for (const m of text.matchAll(/createProvider\(\s*['"](\w+)['"]/g)) {
      const provider = `${FE}/services/providers/http/${m[1]}Provider.js`;
      if (known.has(provider)) deps.add(provider);
    }
    for (const d of deps) addTo(importers, d, f);
  }
  return { files, importers, resolve };
}

function routeTable(resolve) {
  const text = read(APP);
  const idFile = new Map();
  const idNamespaces = new Map();
  for (const m of text.matchAll(/const\s+(\w+)\s*=\s*(?:lazy|lazyPage)\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)([^;]*);/g)) {
    idFile.set(m[1], resolve(APP, m[2]));
    idNamespaces.set(m[1], [...m[3].matchAll(/['"]([\w-]+)['"]/g)].map((x) => x[1]));
  }
  for (const m of text.matchAll(/^import\s+(\w+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s+['"](\.[^'"]+)['"]/gm)) {
    const file = resolve(APP, m[3]);
    if (!file) continue;
    if (m[1]) idFile.set(m[1], file);
    for (const name of (m[2] ?? '').split(',').map((s) => s.trim().split(/\s+as\s+/).at(-1))) {
      if (name) idFile.set(name, file);
    }
  }
  const wrappers = new Map();
  for (const m of text.matchAll(/function\s+([A-Z]\w*)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g)) {
    wrappers.set(m[1], [...m[2].matchAll(/<([A-Z]\w*)/g)].map((x) => x[1]));
  }
  const componentsIn = (jsx) => {
    const ids = new Set();
    const queue = [...jsx.matchAll(/<([A-Z]\w*)/g)].map((x) => x[1]);
    while (queue.length) {
      const id = queue.pop();
      if (ids.has(id)) continue;
      ids.add(id);
      queue.push(...(wrappers.get(id) ?? []));
    }
    return [...ids];
  };

  const pageRoutes = new Map();
  const namespaceRoutes = new Map();
  const enclosing = [];
  const TAG = /<Route\b|<\/Route>/g;
  let m;
  while ((m = TAG.exec(text))) {
    if (m[0] === '</Route>') {
      enclosing.pop();
      continue;
    }
    const { end, selfClosing } = jsxTagEnd(text, m.index + m[0].length);
    TAG.lastIndex = end;
    const attrs = text.slice(m.index, end);
    const ids = componentsIn(attrs);
    const p = attrs.match(/\bpath=(?:"([^"]+)"|\{`([^`]+)`\})/);
    if (p) {
      const raw = p[1] ?? p[2];
      const routes = raw.includes('${')
        ? [raw.replace(/\$\{[^}]*\}/g, ''), raw.replace(/\$\{[^}]*\}/g, '/:lang')]
        : [raw];
      for (const id of [...ids, ...enclosing.flat()]) {
        const file = idFile.get(id);
        if (!file) continue;
        for (const r of routes) addTo(pageRoutes, file, r);
      }
      for (const id of ids) {
        for (const ns of idNamespaces.get(id) ?? []) routes.forEach((r) => addTo(namespaceRoutes, ns, r));
      }
    }
    if (!selfClosing) enclosing.push(ids);
  }
  return { pageRoutes, namespaceRoutes };
}

function jsxTagEnd(text, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = null;
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    } else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return { end: i + 1, selfClosing: text[i - 1] === '/' };
  }
  throw new Error(`unterminated <Route> tag in ${APP} at offset ${from}`);
}

function routesReachedFrom(start, { importers }, { pageRoutes }) {
  if (SHELL.has(start)) return { full: `${start} is the app shell` };
  const routes = new Set();
  const pages = new Set();
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const f = queue.shift();
    const own = pageRoutes.get(f);
    if (own) {
      pages.add(f);
      own.forEach((r) => routes.add(r));
    }
    for (const up of importers.get(f) ?? []) {
      if (SHELL.has(up)) {
        if (!own) return { full: `${start} reaches ${up} through ${f}, outside any route` };
        continue;
      }
      if (!seen.has(up)) {
        seen.add(up);
        queue.push(up);
      }
    }
  }
  if (!routes.size) return { full: `${start} reaches no route (no importer found)` };
  return { routes, pages };
}

function specIndex() {
  const specs = walk('e2e/tests', (n) => n.endsWith('.spec.js'));
  const closureCache = new Map();
  const localImports = (file) => {
    const out = [];
    for (const m of read(file).matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (!spec.startsWith('.')) continue;
      const base = path.posix.join(path.posix.dirname(file), spec);
      const hit = ['', '.js', '.mjs'].map((e) => base + e).find((c) => existsSync(abs(c)));
      if (hit && /\.m?js$/.test(hit)) out.push(hit);
    }
    return out;
  };
  const closure = (file) => {
    if (closureCache.has(file)) return closureCache.get(file);
    const seen = new Set();
    const stack = [file];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      stack.push(...localImports(f));
    }
    closureCache.set(file, seen);
    return seen;
  };
  return specs.map((spec) => {
    const files = closure(spec);
    const texts = [...files].map((f) => ({ f, text: stripComments(read(f)) }));
    const targets = new Set();
    for (const { f, text } of texts) {
      if (NAV_PLUMBING.has(f)) continue;
      for (const m of text.matchAll(/['"`](\/[^'"`\s]*)/g)) targets.add(m[1].split(/[?#]/)[0]);
    }
    return { spec, files, text: texts.map((t) => t.text).join('\n'), targets };
  });
}

const segments = (p) => p.split('/').filter(Boolean);
function routeMatches(route, target) {
  if (route.includes('*')) return false;
  const r = segments(route);
  const t = segments(target);
  return r.length === t.length && r.every((s, i) => s.startsWith(':') || t[i].includes('${') || s === t[i]);
}

function pageTokens(page) {
  if (!page.startsWith(`${FE}/pages/`)) return [];
  const parts = page.slice(`${FE}/pages/`.length).split('/');
  const name = parts.at(-1).replace(/\.\w+$/, '').replace(/^(Admin|Ops)(?=[A-Z])/, '');
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return [kebab, ...parts.slice(1, -1)].filter((t) => t.length >= 4);
}

function routeConstants() {
  const src = stripJavaComments(read(ROUTES_JAVA));
  const TOKEN = /\bString\s+(\w+)\s*=\s*([^;]+);|"(?:[^"\\]|\\.)*"|\bclass\s+(\w+)|[{}]/g;
  const stack = [];
  let pendingClass = null;
  const raw = new Map();
  for (const m of src.matchAll(TOKEN)) {
    const owner = stack.at(-1);
    if (m[1]) raw.set(`${owner}.${m[1]}`, { owner, expr: m[2] });
    else if (m[3]) pendingClass = m[3];
    else if (m[0] === '{') {
      stack.push(pendingClass ?? owner);
      pendingClass = null;
    } else if (m[0] === '}') stack.pop();
  }
  const memo = new Map();
  const value = (key, depth = 0) => {
    if (memo.has(key)) return memo.get(key);
    const c = raw.get(key);
    if (!c || depth > 20) return null;
    let out = '';
    for (const part of c.expr.split('+').map((s) => s.trim())) {
      const lit = part.match(/^"((?:[^"\\]|\\.)*)"$/);
      if (lit) {
        out += lit[1];
        continue;
      }
      const ref = part.split('.').slice(-2);
      const v = value(ref.length === 2 ? ref.join('.') : `${c.owner}.${ref[0]}`, depth + 1);
      if (v == null) return null;
      out += v;
    }
    memo.set(key, out);
    return out;
  };
  return (ref) => value(ref.split('.').slice(-2).join('.'));
}

let javaIndex;
function java() {
  if (javaIndex) return javaIndex;
  const classes = walk(BE, (n) => n.endsWith('.java')).map((file) => {
    const text = stripJavaComments(read(file));
    const pkg = text.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? '';
    const name = path.posix.basename(file, '.java');
    const head = text.match(new RegExp(`\\b(?:class|interface|record|enum)\\s+${name}\\b([^{]*)\\{`))?.[1] ?? '';
    return {
      file, text, pkg, name,
      fq: `${pkg}.${name}`,
      injectable: new RegExp(`\\b(?:interface|abstract\\s+class)\\s+${name}\\b`).test(text),
      listens: /@(?:Transactional)?EventListener\b|@ApplicationModuleListener\b/.test(text),
      supers: [...new Set(head.match(/\b[A-Z]\w*/g) ?? [])],
      wildcards: [...text.matchAll(/^\s*import\s+([\w.]+)\.\*\s*;/gm)].map((m) => m[1]),
    };
  });
  const byFile = new Map(classes.map((c) => [c.file, c]));
  const byName = new Map();
  const byToken = new Map();
  for (const c of classes) {
    addTo(byName, c.name, c);
    for (const tok of new Set(c.text.match(/\b[A-Z]\w*/g) ?? [])) addTo(byToken, tok, c);
  }
  return (javaIndex = { byFile, byName, byToken });
}

function dependentClasses(startFile) {
  const { byFile, byName, byToken } = java();
  const seen = new Set([startFile]);
  const queue = [startFile];
  while (queue.length) {
    const c = byFile.get(queue.shift());
    if (!c) continue;
    const next = [...(byToken.get(c.name) ?? [])].filter(
      (g) => g.pkg === c.pkg || g.text.includes(c.fq) || g.wildcards.includes(c.pkg),
    );
    for (const s of c.supers) {
      for (const t of byName.get(s) ?? []) {
        if (t.injectable && (t.pkg === c.pkg || c.text.includes(t.fq) || c.wildcards.includes(t.pkg))) next.push(t);
      }
    }
    for (const g of next) if (!seen.has(g.file)) { seen.add(g.file); queue.push(g.file); }
  }
  return seen;
}

function endpointPatterns(files, constant) {
  const patterns = new Set();
  const unresolved = new Set();
  const MAPPING = /@(?:Request|Get|Post|Put|Patch|Delete)Mapping\s*\(([^)]*)\)/g;
  const PLACEHOLDER = '(?:[^/\'"`\\s]+|\\$\\{[^}]*\\})';
  for (const f of files) {
    const src = stripJavaComments(read(f));
    const local = new Map([...src.matchAll(/\bstatic\s+final\s+String\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
    const resolve = (expr, depth = 0) => {
      if (depth > 10) return null;
      let out = '';
      for (const part of expr.split('+').map((s) => s.trim())) {
        const lit = part.match(/^"((?:[^"\\]|\\.)*)"$/);
        const v = lit ? lit[1] : part.includes('.') ? constant(part) : local.has(part) ? resolve(local.get(part), depth + 1) : null;
        if (v == null) return null;
        out += v;
      }
      return out;
    };
    for (const m of src.matchAll(MAPPING)) {
      for (const t of m[1].matchAll(/"((?:[^"\\]|\\.)*)"|\b([A-Z]\w*(?:\.\w+)+|[A-Z][A-Z0-9_]*)\b/g)) {
        const p = (t[1] ?? resolve(t[2]))?.replace(/\/+$/, '');
        if (p == null && (t[2].startsWith('Routes.') || !t[2].includes('.'))) unresolved.add(t[2]);
        if (!p?.startsWith('/') || p.length < 3) continue;
        patterns.add(p.split(/\{[^}]*\}|\*+/).map(escapeRe).join(PLACEHOLDER));
      }
    }
  }
  return { patterns, unresolved };
}
const FUNCTION_HEAD =
  /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\b|\()|^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{|^\s*(\w+)\s*:\s*(?:async\b|\(|function)/;

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'function']);

function enclosingFunctions(text, re) {
  const lines = text.split('\n');
  const names = new Set();
  let offset = 0;
  const starts = lines.map((l) => ((offset += l.length + 1), offset - l.length - 1));
  for (const m of text.matchAll(new RegExp(re.source, 'gm'))) {
    let line = starts.findLastIndex((s) => s <= m.index);
    for (; line >= 0; line--) {
      const head = lines[line].match(FUNCTION_HEAD);
      const name = head?.slice(1).find(Boolean);
      if (name && !KEYWORDS.has(name)) {
        names.add(name);
        break;
      }
    }
  }
  return names;
}

function endpointCallers(file, endpointRe, { files, importers }) {
  const text = stripComments(read(file));
  let names = enclosingFunctions(text, endpointRe);
  let services = [file];
  const domain = file.match(/\/services\/providers\/http\/(\w+)Provider\.js$/)?.[1];
  if (domain) {
    services = files.filter((f) => new RegExp(`createProvider\\(\\s*['"]${domain}['"]`).test(read(f)));
    const exported = new Set();
    for (const svc of services) {
      for (const block of read(svc).split(/\n(?=export\s)/)) {
        const name = block.match(/^export\s+(?:const|(?:async\s+)?function)\s+(\w+)/)?.[1];
        if (name && [...names].some((n) => new RegExp(`\\.${n}\\s*\\(`).test(block))) exported.add(name);
      }
    }
    names = exported;
  }
  if (!names.size || !services.length) return [file];
  const nameRe = new RegExp(`\\b(${[...names].join('|')})\\b`);
  return services.flatMap((svc) => [...(importers.get(svc) ?? [])].filter((u) => nameRe.test(read(u))));
}

export function relatedSpecs(changed) {
  const full = [];
  const picked = new Map();
  const pick = (spec, why) => addTo(picked, spec, why);
  const ignored = [];

  let fe;
  let routesTable;
  let specs;
  let constant;
  const frontend = () => (fe ??= frontendGraph());
  const table = () => (routesTable ??= routeTable(frontend().resolve));
  const index = () => (specs ??= specIndex());
  const pickRoutes = (routes, pages, why) => {
    const tokens = [...pages].flatMap(pageTokens);
    const tokenRe = tokens.length ? new RegExp(`(^|[/-])(${tokens.map(escapeRe).join('|')})([/.-]|$)`) : null;
    for (const s of index()) {
      const hit = [...routes].find((r) => [...s.targets].some((t) => routeMatches(r, t)));
      if (hit) pick(s.spec, `${why} -> route ${hit}`);
      else if (tokenRe?.test(s.spec.slice('e2e/tests/'.length))) pick(s.spec, `${why} -> name matches page`);
    }
  };
  const frontendFile = (f, why = f) => {
    if (AUTH_PAGES.has(f)) return full.push(`${f} is the sign-in page every spec drives`);
    const reach = routesReachedFrom(f, frontend(), table());
    if (reach.full) return full.push(reach.full);
    pickRoutes(reach.routes, reach.pages, why);
  };

  for (const f of changed) {
    const exists = existsSync(abs(f));
    if (f.startsWith('e2e/tests/') && f.endsWith('.spec.js')) {
      if (exists) pick(f, 'spec changed');
    } else if (E2E_FULL.has(f)) {
      full.push(`${f} configures the whole suite`);
    } else if (/^e2e\/(?!tests\/.*\.spec\.js$|scripts\/).*\.m?js$/.test(f)) {
      const users = index().filter((s) => s.files.has(f));
      if (!exists || !users.length) full.push(`${f}: e2e support file with no traceable importer`);
      users.forEach((s) => pick(s.spec, `imports ${f}`));
    } else if (f.startsWith(`${FE}/`)) {
      if (/\.(test|spec)\.[jt]sx?$|\/__tests__\//.test(f)) ignored.push(f);
      else if (!exists) full.push(`${f} was deleted; its importers cannot be traced`);
      else {
        const ns = f.match(/^frontend\/src\/i18n\/locales\/[\w-]+\/([\w-]+)\.json$/);
        if (ns) {
          const routes = table().namespaceRoutes.get(ns[1]);
          if (routes) pickRoutes(routes, [], `${f} (namespace ${ns[1]})`);
          else full.push(`${f}: namespace ${ns[1]} is loaded by the shell, not a route`);
        } else frontendFile(f);
      }
    } else if (f.startsWith('frontend/')) {
      if (/^frontend\/(scripts\/(?!vite-plugin)|README|docs\/)/.test(f) || f.endsWith('.md')) ignored.push(f);
      else full.push(`${f} changes the frontend build`);
    } else if (f.startsWith(`${BE}/`)) {
      const module = f.slice(BE.length + 1).split('/')[0];
      if (!module.length || !f.slice(BE.length + 1).includes('/') || FULL_BACKEND_MODULES.has(module)) {
        full.push(`${f} is shared backend infrastructure`);
        continue;
      }
      if (!existsSync(abs(f))) {
        full.push(`${f} was deleted; its dependents cannot be traced`);
        continue;
      }
      constant ??= routeConstants();
      const reached = [...dependentClasses(f)];
      const listener = reached.find((c) => java().byFile.get(c)?.listens);
      if (listener) {
        full.push(`${f} reaches event listener ${listener}`);
        continue;
      }
      const { patterns: endpoints, unresolved } = endpointPatterns(reached, constant);
      if (unresolved.size) {
        full.push(`${f}: route constant(s) ${[...unresolved].slice(0, 3).join(', ')} could not be resolved`);
        continue;
      }
      if (!endpoints.size) {
        full.push(`${f}: no controller reaches it, so its endpoints cannot be traced`);
        continue;
      }
      const via = `${module} (${reached.length} dependent class${reached.length === 1 ? '' : 'es'})`;
      const endpointRe = new RegExp(`(${[...endpoints].join('|')})(?=[?#'"\`]|$)`, 'm');
      for (const s of index()) {
        const hit = s.text.match(endpointRe);
        if (hit) pick(s.spec, `backend ${via} -> endpoint ${hit[1]}`);
      }
      for (const file of frontend().files) {
        if (file.startsWith(`${FE}/services/`) && /\.(jsx?|mjs|tsx?)$/.test(file) && endpointRe.test(stripComments(read(file)))) {
          for (const caller of endpointCallers(file, endpointRe, frontend())) {
            frontendFile(caller, `backend ${module} via ${file} -> ${caller}`);
          }
        }
      }
    } else if (f.startsWith('backend/src/main/') || f === 'backend/pom.xml') {
      full.push(`${f} changes backend configuration, schema or seeds`);
    } else {
      ignored.push(f);
    }
  }

  const unique = [...new Set(full)];
  const selected = unique.length ? [] : [...picked.keys()].sort();
  const anyCodeChanged = ignored.length < changed.length;
  if (!unique.length && anyCodeChanged && !selected.includes(CANARY)) {
    selected.push(CANARY);
    addTo(picked, CANARY, 'always-on boot canary');
  }
  const noBackend = (s) => NO_BACKEND.some((g) => s.endsWith(g.replace(/^\*\*\//, '')));
  return {
    full: unique.length > 0,
    reasons: unique,
    live: selected.filter((s) => !noBackend(s)),
    nobackend: selected.filter(noBackend),
    why: Object.fromEntries(selected.map((s) => [s, [...picked.get(s)]])),
    ignored,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const changed = opts.files.length ? opts.files : gitChanged(opts.base);
  const result = { changed, ...relatedSpecs(changed) };
  if (opts.json) {
    process.stdout.write(JSON.stringify(result));
  } else {
    console.log(`${changed.length} changed file(s).`);
    if (result.full) {
      console.log('FULL suite required:');
      result.reasons.forEach((r) => console.log(`  - ${r}`));
    } else {
      console.log(`${result.live.length} live + ${result.nobackend.length} no-backend spec(s):`);
      for (const s of [...result.live, ...result.nobackend]) console.log(`  ${s}\n      ${result.why[s].slice(0, 3).join('\n      ')}`);
    }
  }
}
