#!/usr/bin/env node
/**
 * Dead-export scan for `frontend/src` — which exported symbols does nothing else name?
 *
 * Lives beside `route-census.mjs` in `backend/tools/` despite scanning the frontend, because that
 * directory is where this repo's cross-cutting tooling already is (`gen-catalogue-seed.mjs`,
 * `live-probe.mjs`, `validate_spec.py`). Splitting tools by which tree they happen to read would
 * put two files that answer the same kind of question in two places.
 *
 * ## The asymmetry, which is the entire design
 *
 * This is a text search for an identifier across every other source file. That makes it **sound in
 * exactly one direction**:
 *
 * - **Zero occurrences is a proof of death.** No file anywhere names the symbol, so nothing can
 *   import it, re-export it, or reach it through a namespace. Barrels do not defeat this: an
 *   `export *` re-exporter does not mention the name, but any *consumer* must, whether it writes
 *   `import { foo }` or `ns.foo`.
 * - **A nonzero count proves nothing at all.** `get`, `list`, `create`, `update`, `cancel` and
 *   `digits` are exported from `lib/serviceFlow.js`, and a word-boundary search finds them three
 *   and a half thousand times across the tree — almost none of which are this module. A short,
 *   generic export name is invisible to this technique.
 *
 * So the tool reports **only** the zero-occurrence set, and does not print a "live" list. Printing
 * one would invite the reader to trust a number that is meaningless for precisely the exports most
 * likely to be dead. A scan that is sound one way should say so and offer nothing the other way,
 * rather than presenting both columns as though they were the same kind of fact.
 *
 * ## What is deliberately not scanned
 *
 * `services/providers/**` is excluded. `services/config.js` loads providers through a *non-eager*
 * `import.meta.glob`, so no file names them and all 64 would be reported dead. They are not; the
 * glob is load-bearing and must stay non-eager. This exclusion is the one hand-maintained thing
 * here, and it is one line rather than a list because the whole directory shares the reason.
 *
 * `e2e/` is included as a *consumer* corpus (a symbol used only by a spec is alive) but never as a
 * subject.
 *
 * ## Usage
 *
 *   node backend/tools/dead-exports.mjs                 # every dead export, grouped by file
 *   node backend/tools/dead-exports.mjs src/lib         # restrict subjects to a subtree
 *   node backend/tools/dead-exports.mjs --json
 *
 * Exit code is always 0. A dead export is not necessarily a defect — a constant published for a
 * screen that has not been built is a judgement call, not a bug — and a scan that fails the build
 * gets switched off.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUBJECT_ROOT = join(REPO, 'frontend/src');
/** Consumer corpora. `e2e` counts as a caller; nothing in it is ever a subject. */
const CONSUMER_ROOTS = [join(REPO, 'frontend/src'), join(REPO, 'e2e')];

/** See the header: excluded because `services/config.js` reaches these through a non-eager glob. */
const NOT_SUBJECTS = /[\\/]services[\\/]providers[\\/]/;

/** `export function f`, `export async function f`, `export const F`, `export class C`. */
const EXPORT_DECL = /^export (?:async )?(?:function|const|class) (\w+)/gm;

function collect(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (extname(full) === '.js' || extname(full) === '.jsx') acc.push(full);
  }
  return acc;
}

const filter = process.argv.find((a) => !a.startsWith('--') && a.includes('src'));
const subjects = collect(SUBJECT_ROOT)
  .filter((f) => !NOT_SUBJECTS.test(f))
  .filter((f) => !filter || relative(REPO, f).split(sep).join('/').includes(filter));

const consumers = CONSUMER_ROOTS.flatMap((r) => collect(r));
const text = new Map(consumers.map((f) => [f, readFileSync(f, 'utf8')]));

/**
 * Concatenating every consumer once and searching that would be simpler, but it would also have to
 * be rebuilt per subject to exclude the subject's own file — the definition itself is an
 * occurrence. Holding the file texts and skipping one is the same work without the quadratic
 * string building.
 */
function referencedElsewhere(name, ownPath) {
  const needle = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  for (const [path, body] of text) {
    if (path === ownPath) continue;
    if (needle.test(body)) return true;
  }
  return false;
}

const findings = [];
for (const file of subjects) {
  const body = readFileSync(file, 'utf8');
  const dead = [...body.matchAll(EXPORT_DECL)]
    .map((m) => m[1])
    .filter((name) => !referencedElsewhere(name, file));
  if (dead.length) findings.push({ file: relative(REPO, file).split(sep).join('/'), dead });
}

const total = findings.reduce((n, f) => n + f.dead.length, 0);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ subjects: subjects.length, files: findings.length, total, findings }, null, 2));
} else {
  console.log(`subjects=${subjects.length} files_with_dead_exports=${findings.length} dead_exports=${total}`);
  // ASCII on purpose: this output is routinely redirected into a log that PowerShell 5.1 renders
  // as ANSI, and an em-dash there arrives as mojibake in the one place a reader is looking for a
  // clean answer.
  console.log('\nOnly zero-occurrence symbols are listed. A symbol absent here is NOT thereby proven');
  console.log('live -- short generic names (get, list, create) match everywhere and this scan');
  console.log('cannot see through them.\n');
  for (const f of findings) console.log(`${f.file}\n    ${f.dead.join(', ')}`);
}
