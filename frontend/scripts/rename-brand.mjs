#!/usr/bin/env node
/**
 * rename-brand.mjs — one-shot, guarded rename of the app's brand name.
 *
 * Why this exists: the brand ("PuneNest") is hardcoded in ~140 files. When the
 * name is finalized, run this once instead of hand-editing every file.
 *
 * Safety rules (the important part):
 *   - Only the FULL brand tokens are replaced: `PuneNest`, `punenest`, and the
 *     domain `punenest.com`. The bare city name `Pune` is NEVER matched, so
 *     real-place references ("areas of Pune") stay intact.
 *   - Replacements run most-specific-first (domain, then Name, then slug) so an
 *     email like hello@punenest.com rewrites cleanly.
 *   - Dry-run by default. Nothing is written unless you pass --apply.
 *   - Generated caches, deps and build output are excluded.
 *
 * Usage:
 *   npm run rename:brand -- --check     # preview counts, writes nothing (default)
 *   npm run rename:brand -- --apply     # perform the rename
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const CHECK = args.includes('--check') || !APPLY; // default = dry run

// --- Load & validate config -------------------------------------------------
const cfgPath = join(ROOT, 'brand.config.json');
let cfg;
try {
  cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
} catch (e) {
  console.error(`✖ Could not read brand.config.json: ${e.message}`);
  process.exit(1);
}

const { oldName, newName, oldSlug, newSlug, oldDomain, newDomain } = cfg;

for (const [k, v] of Object.entries({ oldName, newName, oldSlug, newSlug, oldDomain, newDomain })) {
  if (!v || typeof v !== 'string') {
    console.error(`✖ brand.config.json is missing required string field: "${k}"`);
    process.exit(1);
  }
}

const noNameChange = oldName === newName && oldSlug === newSlug && oldDomain === newDomain;
if (noNameChange) {
  console.error(
    '✖ Nothing to do: the "new" fields still equal the "old" fields.\n' +
    '  Edit brand.config.json — set newName / newSlug / newDomain to the finalized brand — then re-run.'
  );
  process.exit(1);
}

if (newSlug !== newSlug.toLowerCase()) {
  console.error(`✖ newSlug must be lowercase (got "${newSlug}"). Slugs are used in package name, emails and URLs.`);
  process.exit(1);
}

// --- What we walk / skip ----------------------------------------------------
// Include the app source plus a few root files that carry the brand.
const INCLUDE_ROOTS = ['src', 'index.html', 'package.json', 'README.md'];
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'target', 'test-results', 'playwright-report', '.git', 'graphify-out']);
const TEXT_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.txt', '.svg']);

// Replacements, ordered most-specific first so later, broader tokens can't
// clobber a match the earlier rule already handled.
const REPLACEMENTS = [
  { from: oldDomain, to: newDomain },                                   // punenest.com -> newdomain
  { from: oldName, to: newName },                                       // PuneNest     -> NewName
  { from: oldName.toUpperCase(), to: newName.toUpperCase() },           // PUNENEST     -> NEWNAME
  { from: oldSlug, to: newSlug },                                       // punenest     -> newslug
];

function walk(path, out) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (EXCLUDE_DIRS.has(entry)) continue;
      walk(join(path, entry), out);
    }
  } else if (st.isFile()) {
    if (TEXT_EXT.has(extname(path))) out.push(path);
  }
}

const files = [];
for (const rootEntry of INCLUDE_ROOTS) {
  const p = join(ROOT, rootEntry);
  try {
    walk(p, files);
  } catch {
    // Missing optional file (e.g. README.md) is fine.
  }
}

function countAndReplace(text) {
  let result = text;
  let total = 0;
  for (const { from, to } of REPLACEMENTS) {
    if (from === to) continue;
    const parts = result.split(from);
    const hits = parts.length - 1;
    if (hits > 0) {
      total += hits;
      result = parts.join(to);
    }
  }
  return { result, total };
}

// --- Run --------------------------------------------------------------------
let filesChanged = 0;
let totalHits = 0;
const perFile = [];

for (const file of files) {
  const original = readFileSync(file, 'utf8');
  const { result, total } = countAndReplace(original);
  if (total > 0) {
    filesChanged++;
    totalHits += total;
    perFile.push({ file: relative(ROOT, file), total });
    if (APPLY) writeFileSync(file, result, 'utf8');
  }
}

// --- Report -----------------------------------------------------------------
perFile.sort((a, b) => b.total - a.total);
const mode = APPLY ? 'APPLIED' : 'DRY RUN (no files written)';

console.log(`\nBrand rename — ${mode}`);
console.log(`  ${oldName}  ->  ${newName}`);
console.log(`  ${oldSlug}  ->  ${newSlug}`);
console.log(`  ${oldDomain}  ->  ${newDomain}\n`);

for (const { file, total } of perFile) {
  console.log(`  ${String(total).padStart(4)}  ${file}`);
}

console.log(`\n  ${totalHits} replacement(s) across ${filesChanged} file(s).`);

if (!APPLY) {
  console.log('\n  This was a preview. Re-run with --apply to write the changes:');
  console.log('    npm run rename:brand -- --apply\n');
} else {
  console.log('\n  Done. Review the diff, run the app, and run the Playwright suite to verify.\n');
}
