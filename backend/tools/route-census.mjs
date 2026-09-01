#!/usr/bin/env node
/**
 * Route census — which server routes does the frontend never mention?
 *
 * ## Why this file exists at all
 *
 * This script had been re-typed by hand into a PowerShell one-liner every time the census was run,
 * a dozen or more times across the migration. It carried a bug the entire way, and the bug was
 * invisible precisely *because* it was re-typed: the class-member regex required `public static
 * final String`, so every route class whose `BASE` is declared `private` failed to resolve, and
 * the script reported those constants as "unresolved" rather than as reached or unreached. Sixteen
 * of two hundred and forty-seven. Fourteen of them were in fact reached and the other two were
 * something more interesting (see below) — but the number in the notes said `unresolved=16` for
 * weeks and nobody looked at it, because an unresolved count is not a finding, it is a footnote.
 *
 * That is the actual lesson and it is worth stating plainly: **a tool that is re-created from
 * memory each time it is used cannot accumulate fixes.** It can only accumulate the parts of
 * itself that are memorable. Committing it costs one file and stops the next fix from evaporating.
 *
 * ## What it does
 *
 * 1. Parses `Routes.java` into `Class.CONSTANT -> expression`, keeping declaration order.
 * 2. Resolves the string-concatenation expressions to literal paths, iterating to a fixed point
 *    (constants reference siblings and other classes, so one pass is not enough).
 * 3. Builds one big string out of every `.js`/`.jsx` under `frontend/src`, minus the mock API,
 *    i18n bundles and `db.json` — the sources that are on their way out and would give false
 *    *positives*.
 * 4. For each resolved path, searches that index for the path's literal prefix (everything before
 *    the first `{`), requiring the hit to begin at a path boundary — see {@link mentions}.
 *
 * ## "Mentioned" is not "called", and the difference is the interesting part
 *
 * The index is text, so a route named in a comment counts as a mention. That is not a defect to be
 * engineered away — a comment naming an endpoint usually means somebody considered it — but it is
 * a distinction the reader needs, and conflating the two hides exactly the routes worth knowing
 * about. `POST /documents/requests` is the example: the only place the frontend names it is a
 * table in `documentService.js` explaining that the buyer's side of the document gate has no
 * faithful contract surface and stays mock-only. That is a deliberate, documented gap, and
 * reporting it as "reached" is worse than reporting it as unreached, because it is the one
 * category that needs no investigation and gets none either way.
 *
 * So the census builds two indexes — everything, and everything minus prose — and a route matched
 * only by the first is reported as `DOCUMENTED`.
 *
 * Prose stripping is deliberately conservative: block comments are removed, and lines whose first
 * non-space character is `*` or `//` are dropped. Inline trailing `//` is left alone, because
 * every `http://` in the file would take the rest of its line with it — a comment stripper that
 * eats URLs would silently un-match every absolute endpoint in the codebase, which is the same
 * class of quiet wrongness this whole script exists to find.
 *
 * ## What a "miss" does and does not mean
 *
 * A miss means *no frontend file contains the literal prefix*. That is weaker than "unreached", in
 * one specific and non-obvious way, which this script now reports rather than leaving to be
 * rediscovered:
 *
 * A route can be reached by passing a literal value into a *sibling template* route. The vault is
 * the live example. `GET /me/documents/personal` exists as its own handler, but the client never
 * writes that path — it calls `listDocuments(mobile, 'personal')`, which builds
 * `/me/documents/${propId}` with `propId = 'personal'`, and Spring resolves it to the personal
 * handler because a literal segment out-ranks a template one. `MeDocumentsController` says so in
 * its own Javadoc; the census could not see it, and reported a live, exercised route as unreached.
 *
 * So misses are split into three buckets.
 *
 * - `MATCHER` — the constant is not an endpoint. `/properties/*` and `/dev/storage/**` exist to be
 *   handed to Spring Security's path matching, and no client ever requests them. Expecting the
 *   frontend to mention them is a category error, and leaving them in the unreached list means the
 *   headline number is permanently four or five too high, which is how a report stops being read.
 * - `SHADOWED` — some *other* resolved route is a pattern that also matches this path, so the
 *   frontend may be reaching it through that sibling. Not a verdict: an instruction to go and read
 *   the caller.
 * - `UNREACHED` — nothing in the frontend mentions it and no sibling could be standing in for it.
 *
 * The shadow test compares whole paths segment by segment, not just the tail. That matters:
 * `/me/documents/personal/{docId}` is shadowed at its *third* segment by
 * `/me/documents/{propId}/{docId}`, and a tail-only test — which is what this had first — reports
 * the list route as shadowed and the delete route beside it as unreached, which is worse than
 * reporting both wrongly, because the inconsistency reads as a real distinction.
 *
 * All three buckets are computed from the route table rather than kept as a hand-maintained
 * exception list, because a hand-maintained list of exceptions inside a detector is the thing that
 * goes stale first (see register item 33 for the same mistake made in a warning message).
 *
 * ## Usage
 *
 *   node backend/tools/route-census.mjs              # summary + the miss list
 *   node backend/tools/route-census.mjs --all        # also print every resolved path
 *   node backend/tools/route-census.mjs --json       # machine-readable
 *
 * Exit code is always 0. This is a report, not a gate: a route with no frontend caller is very
 * often correct (webhooks, dev-only storage, admin surfaces that were deliberately deferred), and
 * a census that fails the build would be turned off within a week.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTES_JAVA = join(REPO, 'backend/src/main/java/com/punenest/api/common/web/Routes.java');
const FRONTEND_SRC = join(REPO, 'frontend/src');

/**
 * Sources excluded from the index. Each is a source of false *positives* — a file that mentions a
 * path without the live app ever calling it — so leaving them in would make unreached routes look
 * reached, which is the failure mode that matters here.
 *
 * `mockApi` is the localStorage provider being retired; it mirrors endpoint names in comments and
 * in its own fake routing. `i18n` bundles carry help copy that quotes URLs. `db.json` is fixture
 * data.
 */
const EXCLUDE = /mockApi|i18n|db\.json/;

/** Paths shorter than this are too generic to search for — `/me`, `/api` would match everything. */
const MIN_PREFIX = 4;

// ── 1. Parse ────────────────────────────────────────────────────────────────────────────────────

/**
 * `static final class Foo` opens a scope; every `static final String BAR = ...;` inside it becomes
 * `Foo.BAR`. Visibility is deliberately not part of either pattern — that was the original bug.
 * A `private` BASE is still a BASE, and its only difference is that nothing outside the class can
 * name it, which is irrelevant to resolving the constants that do.
 */
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

// ── 2. Resolve ──────────────────────────────────────────────────────────────────────────────────

/**
 * Expand `A + B + "literal"` to a string, iterating until nothing new resolves.
 *
 * A bare `NAME` reference is looked up in the declaring class first, which is how Java itself
 * scopes it. `Other.NAME` is looked up globally. Anything else — a method call, a formatted
 * string — leaves the constant unresolved, and unresolved constants are reported loudly rather
 * than skipped, because a silently-skipped route is a route the census claims nothing about.
 */
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

// ── 3. Index the frontend ───────────────────────────────────────────────────────────────────────

function collectSources(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (EXCLUDE.test(full)) continue;
    if (statSync(full).isDirectory()) collectSources(full, acc);
    else if (extname(full) === '.js' || extname(full) === '.jsx') acc.push(full);
  }
  return acc;
}

/** Remove prose. See the header for why trailing `//` is left in place. */
function stripProse(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join('\n');
}

// ── 4. Classify ─────────────────────────────────────────────────────────────────────────────────

/** Everything before the first path variable — the part a caller must write out literally. */
function literalPrefix(path) {
  const brace = path.indexOf('{');
  return (brace >= 0 ? path.slice(0, brace) : path).replace(/\/+$/, '');
}

/**
 * Does the frontend index mention `prefix` as a path in its own right?
 *
 * A plain `includes` is not enough, and the failure is quiet. `POST /documents/requests` is the
 * buyer's side of the document gate and has no frontend caller — the provider's own header says
 * the buyer's side stays mock-only. But `/documents/requests` is a *substring* of
 * `/me/documents/requests`, the owner's inbox, which the frontend calls constantly. So a
 * substring test credits an unreached route to a completely different endpoint that merely ends
 * the same way, and the census reports one fewer gap than exists.
 *
 * The fix is to insist the hit starts at a boundary: the character before it must not be a word
 * character or a `/`, both of which would mean the real path is longer than the one being looked
 * for. In practice the preceding character is a quote, a backtick or an opening parenthesis.
 */
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

/**
 * Is `path` shadowed by a sibling pattern that also matches it? See the header — this is how
 * `/me/documents/personal` is reached without anyone writing `/me/documents/personal`.
 *
 * `other` shadows `path` when they have the same number of segments and, at every position, the
 * segment is either identical or `other`'s is a `{template}` (which matches anything). Two
 * differently-named templates at the same position count as identical: `{propId}` and `{docId}`
 * are the same wildcard wearing different labels, and treating them as distinct would make the
 * test depend on what someone called a variable.
 *
 * A path shadows itself trivially, so the caller must exclude it — here that is automatic, since
 * only *matched* paths are offered as candidates and `path` by definition did not match.
 */
function shadowingSibling(path, matchedPaths) {
  const mine = path.split('/');
  const isVar = (seg) => seg.startsWith('{');
  return matchedPaths.find((other) => {
    const theirs = other.split('/');
    if (theirs.length !== mine.length) return false;
    return theirs.every((seg, i) => isVar(seg) || seg === mine[i]);
  }) ?? null;
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));
const defs = parseRoutes(readFileSync(ROUTES_JAVA, 'utf8'));
const resolved = resolveAll(defs);
const unresolved = [...defs.keys()].filter((k) => !resolved.has(k));

const sources = collectSources(FRONTEND_SRC).map((f) => readFileSync(f, 'utf8'));
const index = sources.join('\n');
const codeIndex = sources.map(stripProse).join('\n');

const considered = [];
for (const [key, path] of resolved) {
  if (!path.startsWith('/')) continue;
  const prefix = literalPrefix(path);
  if (prefix.length < MIN_PREFIX) continue;
  considered.push({ key, path, prefix, inCode: mentions(codeIndex, prefix), inProse: mentions(index, prefix) });
}

const matchedPaths = considered.filter((r) => r.inCode).map((r) => r.path);
const missed = considered.filter((r) => !r.inCode);

const matchers = missed.filter((r) => isMatcher(r.path));
const rest = missed
  .filter((r) => !isMatcher(r.path))
  .map((r) => ({ ...r, shadowedBy: shadowingSibling(r.path, matchedPaths) }));

const shadowed = rest.filter((r) => r.shadowedBy);
const documented = rest.filter((r) => !r.shadowedBy && r.inProse);
const unreached = rest.filter((r) => !r.shadowedBy && !r.inProse);

if (args.has('--json')) {
  console.log(JSON.stringify({ defs: defs.size, resolved: resolved.size, unresolved, considered: considered.length, matchers, shadowed, documented, unreached }, null, 2));
} else {
  console.log(`defs=${defs.size} resolved=${resolved.size} unresolved=${unresolved.length} considered=${considered.length}`);
  console.log(`wired=${matchedPaths.length} matchers=${matchers.length} shadowed=${shadowed.length} documented=${documented.length} unreached=${unreached.length}`);
  if (unresolved.length) {
    console.log('\n--- unresolved (the census claims nothing about these) ---');
    for (const key of unresolved) console.log(`  ${key.padEnd(40)}${defs.get(key)}`);
  }
  if (matchers.length) {
    console.log('\n--- security matchers, not endpoints (no client requests these) ---');
    for (const r of matchers) console.log(`  ${r.key.padEnd(40)}${r.path}`);
  }
  if (shadowed.length) {
    console.log('\n--- shadowed by a sibling pattern (go read the caller before believing these) ---');
    for (const r of shadowed) console.log(`  ${r.key.padEnd(40)}${r.path.padEnd(44)}via ${r.shadowedBy}`);
  }
  if (documented.length) {
    console.log('\n--- named only in a comment: a known, deliberate gap ---');
    for (const r of documented) console.log(`  ${r.key.padEnd(40)}${r.path}`);
  }
  console.log('\n--- no frontend file mentions these ---');
  for (const r of unreached) console.log(`  ${r.key.padEnd(40)}${r.path}`);
  if (args.has('--all')) {
    console.log('\n--- all resolved paths ---');
    for (const r of considered) console.log(`  ${r.inCode ? '  ' : '!!'} ${r.key.padEnd(40)}${r.path}`);
  }
}
