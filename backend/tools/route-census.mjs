#!/usr/bin/env node
// Reports routes in Routes.java that nothing under frontend/src/services/ fetches. A report, not a
// gate: exit is always 0. Usage: node backend/tools/route-census.mjs [--all] [--json]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTES_JAVA = join(REPO, 'backend/src/main/java/com/draazy/api/common/web/Routes.java');
const FRONTEND_SRC = join(REPO, 'frontend/src');

/** Sources that quote a path without calling it — indexing them would make dead routes look live. */
const EXCLUDE = /i18n|db\.json/;

/** Paths shorter than this are too generic to search for — `/me`, `/api` would match everything. */
const MIN_PREFIX = 4;

// The only directory from which the app issues an HTTP request, so a path mentioned elsewhere is a
// browser route wearing the same spelling (`/admin/analytics`). Re-check when a new importer appears.
const API_CALLERS = /[\\/]frontend[\\/]src[\\/]services[\\/]/;

/** Visibility is deliberately not matched: a `private` BASE is still a BASE that others resolve through. */
function parseRoutes(text) {
  const defs = new Map(); // "Class.NAME" -> raw expression, insertion-ordered
  let cls = '';
  for (const line of text.split(/\r?\n/)) {
    const openClass = line.match(/static final class (\w+)/);
    if (openClass) {
      cls = openClass[1];
      continue;
    }
    const constant = line.match(/(?:public|private|protected)\s+static final String (\w+)\s*=\s*(.+?);/);
    if (constant) {
      const key = `${cls}.${constant[1]}`;
      if (!defs.has(key)) defs.set(key, constant[2]);
    }
  }
  return defs;
}

// Expand `A + B + "literal"` to a fixed point; a bare `NAME` resolves in the declaring class first,
// as Java scopes it. Anything unresolved is reported loudly — a skipped route is a claimless route.
function resolveAll(defs) {
  const out = new Map();
  let progress = true;
  while (progress) {
    progress = false;
    for (const [key, expr] of defs) {
      if (out.has(key)) continue;
      const owner = key.split('.')[0];
      let value = '';
      let ok = true;
      for (const rawPart of expr.split(/\s*\+\s*/)) {
        const part = rawPart.trim();
        const literal = part.match(/^"(.*)"$/);
        if (literal) {
          value += literal[1];
        } else if (/^\w+\.\w+$/.test(part) && out.has(part)) {
          value += out.get(part);
        } else if (/^\w+$/.test(part) && out.has(`${owner}.${part}`)) {
          value += out.get(`${owner}.${part}`);
        } else {
          ok = false;
          break;
        }
      }
      if (ok) {
        out.set(key, value);
        progress = true;
      }
    }
  }
  return out;
}

function collectSources(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (EXCLUDE.test(full)) continue;
    if (statSync(full).isDirectory()) collectSources(full, acc);
    else if (extname(full) === '.js' || extname(full) === '.jsx') acc.push(full);
  }
  return acc;
}

/** Remove prose. Trailing `//` is left alone, or every `http://` would take its line with it. */
function stripProse(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join('\n');
}

/** Everything before the first path variable — the part a caller must write out literally. */
function literalPrefix(path) {
  const brace = path.indexOf('{');
  return (brace >= 0 ? path.slice(0, brace) : path).replace(/\/+$/, '');
}

// A plain `includes` would credit `/documents/requests` to the different `/me/documents/requests`,
// so the hit must start at a path boundary — a quote, backtick or paren, never a word char or `/`.
function mentions(index, prefix) {
  let at = index.indexOf(prefix);
  while (at !== -1) {
    const before = at === 0 ? '' : index[at - 1];
    if (!/[\w/]/.test(before)) return true;
    at = index.indexOf(prefix, at + 1);
  }
  return false;
}

/** A Spring Security path matcher rather than a controller mapping — nobody requests these. */
function isMatcher(path) {
  return path.includes('*');
}

/** Derived from the path, not a hand-kept key list, so a webhook added later classifies itself. */
function isInbound(path) {
  return path.startsWith('/webhooks/');
}

// Same segment count, each segment identical or a `{template}` on the other side — two differently
// named templates are one wildcard. Caller must exclude `path`, which shadows itself trivially.
function shadowingSibling(path, matchedPaths) {
  const mine = path.split('/');
  const isVar = (seg) => seg.startsWith('{');
  return matchedPaths.find((other) => {
    const theirs = other.split('/');
    if (theirs.length !== mine.length) return false;
    return theirs.every((seg, i) => isVar(seg) || seg === mine[i]);
  }) ?? null;
}

const args = new Set(process.argv.slice(2));
const defs = parseRoutes(readFileSync(ROUTES_JAVA, 'utf8'));
const resolved = resolveAll(defs);
const unresolved = [...defs.keys()].filter((k) => !resolved.has(k));

const sourceFiles = collectSources(FRONTEND_SRC);
const sources = sourceFiles.map((f) => readFileSync(f, 'utf8'));
const index = sources.join('\n');
const codeIndex = sources.map(stripProse).join('\n');
const serviceIndex = sources
  .filter((_, i) => API_CALLERS.test(sourceFiles[i]))
  .map(stripProse)
  .join('\n');

const considered = [];
for (const [key, path] of resolved) {
  if (!path.startsWith('/')) continue;
  const prefix = literalPrefix(path);
  if (prefix.length < MIN_PREFIX) continue;
  considered.push({
    key,
    path,
    prefix,
    inCode: mentions(codeIndex, prefix),
    inProse: mentions(index, prefix),
    inServices: mentions(serviceIndex, prefix),
  });
}

// `wired` means something under services/ writes this path, the only place a fetch can originate.
// A path mentioned in code but never there is a browser route, and gets its own bucket below.
const matchedPaths = considered.filter((r) => r.inServices).map((r) => r.path);
const missed = considered.filter((r) => !r.inServices);

const matchers = missed.filter((r) => isMatcher(r.path));
const inbound = missed.filter((r) => !isMatcher(r.path) && isInbound(r.path));
const rest = missed
  .filter((r) => !isMatcher(r.path) && !isInbound(r.path))
  .map((r) => ({ ...r, shadowedBy: shadowingSibling(r.path, matchedPaths) }));

const shadowed = rest.filter((r) => r.shadowedBy);
const uiOnly = rest.filter((r) => !r.shadowedBy && r.inCode);
const documented = rest.filter((r) => !r.shadowedBy && !r.inCode && r.inProse);
const unreached = rest.filter((r) => !r.shadowedBy && !r.inCode && !r.inProse);

if (args.has('--json')) {
  console.log(JSON.stringify({ defs: defs.size, resolved: resolved.size, unresolved, considered: considered.length, matchers, inbound, shadowed, uiOnly, documented, unreached }, null, 2));
} else {
  console.log(`defs=${defs.size} resolved=${resolved.size} unresolved=${unresolved.length} considered=${considered.length}`);
  console.log(`wired=${matchedPaths.length} matchers=${matchers.length} inbound=${inbound.length} shadowed=${shadowed.length} ui-only=${uiOnly.length} documented=${documented.length} unreached=${unreached.length}`);
  if (unresolved.length) {
    console.log('\n--- unresolved (the census claims nothing about these) ---');
    for (const key of unresolved) console.log(`  ${key.padEnd(40)}${defs.get(key)}`);
  }
  if (matchers.length) {
    console.log('\n--- security matchers, not endpoints (no client requests these) ---');
    for (const r of matchers) console.log(`  ${r.key.padEnd(40)}${r.path}`);
  }
  if (inbound.length) {
    console.log('\n--- inbound webhooks (a third party calls us; our frontend never can) ---');
    for (const r of inbound) console.log(`  ${r.key.padEnd(40)}${r.path}`);
  }
  if (shadowed.length) {
    console.log('\n--- shadowed by a sibling pattern (go read the caller before believing these) ---');
    for (const r of shadowed) console.log(`  ${r.key.padEnd(40)}${r.path.padEnd(44)}via ${r.shadowedBy}`);
  }
  if (uiOnly.length) {
    console.log('\n--- a screen owns this path in the browser, but nothing under services/ fetches it ---');
    for (const r of uiOnly) console.log(`  ${r.key.padEnd(40)}${r.path}`);
  }
  if (documented.length) {
    console.log('\n--- named only in a comment: a known, deliberate gap ---');
    for (const r of documented) console.log(`  ${r.key.padEnd(40)}${r.path}`);
  }
  console.log('\n--- no frontend file mentions these ---');
  for (const r of unreached) console.log(`  ${r.key.padEnd(40)}${r.path}`);
  if (args.has('--all')) {
    console.log('\n--- all resolved paths ---');
    for (const r of considered) console.log(`  ${r.inServices ? '  ' : '!!'} ${r.key.padEnd(40)}${r.path}`);
  }
}
