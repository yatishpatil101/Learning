#!/usr/bin/env node
/** Dead-export scan for `frontend/src`: reports only zero-occurrence names, as a nonzero count proves nothing for short generic names.
 * `services/providers/**` is excluded because `config.js` loads it through a non-eager `import.meta.glob` that must stay non-eager. */
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

/** Texts are held and the subject's file skipped, avoiding a concatenation rebuilt per subject. */
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
  // ASCII on purpose: logs redirected through PowerShell 5.1 render as ANSI and an em-dash becomes mojibake.
  console.log('\nOnly zero-occurrence symbols are listed. A symbol absent here is NOT thereby proven');
  console.log('live -- short generic names (get, list, create) match everywhere and this scan');
  console.log('cannot see through them.\n');
  for (const f of findings) console.log(`${f.file}\n    ${f.dead.join(', ')}`);
}
