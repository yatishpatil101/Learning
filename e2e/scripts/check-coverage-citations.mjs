/* COVERAGE.md is a two-way gate: stale citations overstate coverage, and undocumented specs hide
   coverage the matrix cannot report. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TESTS = 'tests';

const have = new Set();
const dirs = new Set();
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      dirs.add(path.relative(TESTS, full).replace(/\\/g, '/'));
      walk(full);
    } else if (entry.name.endsWith('.spec.js')) {
      have.add(path.relative(TESTS, full).replace(/\\/g, '/').replace(/\.spec\.js$/, ''));
    }
  }
})(TESTS);

const doc = readFileSync('COVERAGE.md', 'utf8');

/* Anchor path citations on real test roots and skip retired rows; otherwise app routes, source
   paths and intentionally deleted specs become false failures. */
const ROOTS = new Set(readdirSync(TESTS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
const RETIRED = /\(retired\b/i;
const cited = new Set();
for (const line of doc.split('\n')) {
  if (RETIRED.test(line)) continue;
  for (const [, name] of line.matchAll(/(?<![/\w-])([a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+(?:\/?\*+|-\*)?)/g)) {
    if (ROOTS.has(name.split('/')[0])) cited.add(name);
  }
}

const missing = [...cited].filter((n) => {
  // A trailing `-*` or `/**` is a deliberate glob — satisfied by any matching spec.
  if (n.endsWith('*')) {
    const prefix = n.replace(/\/?\*+$/, '');
    return ![...have].some((h) => h === prefix || h.startsWith(prefix));
  }
  // The folder-summary table names folders rather than specs; both are real.
  return !have.has(n) && !dirs.has(n);
}).sort();

/* Bare spec names are validated only in the spec column; elsewhere ordinary prose words look like
   basenames and would drown the gate in false positives. */
const basenames = new Set([...have].map((h) => h.split('/').pop()));
const STATUS = /^(✅|🟡|❌|⚠️|⬜)/u;
const bareMissing = new Set();
const citedBare = new Set();
for (const line of doc.split('\n')) {
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').map((c) => c.trim());
  // `split` leaves an empty cell either side of the row's outer pipes.
  if (!STATUS.test(cells[cells.length - 2] || '')) continue;
  const specCell = (cells[cells.length - 3] || '').split(/[(—–"*`:]/)[0];
  for (const part of specCell.split(',')) {
    const token = part.trim().split(/\s+/)[0];
    if (!/^[a-z][a-z0-9-]*$/.test(token)) continue; // bare only; paths are covered above
    if (token === 'backend') continue; // `backend `OtpService`` cites a JUnit class, not a spec
    citedBare.add(token);
    if (!basenames.has(token) && !have.has(token) && !dirs.has(token)) bareMissing.add(token);
  }
}

/* UNDOCUMENTED is a self-emptying worklist: cited or deleted entries fail so the allowlist cannot
   become permanent. */
const UNDOCUMENTED = [
  'consumer/account/live-listing-freshness',
  'consumer/live-localities',
  'consumer/live-reels',
  'consumer/live-trust-counters',
  'consumer/property/signin-gates',
  'consumer/services/live-interior-lead',
  'live-admin-content',
  'live-admin-services',
  'live-demand-signals',
  'live-service-landing-ticket',
];

const globPrefixes = [...cited].filter((n) => n.endsWith('*')).map((n) => n.replace(/\/?\*+$/, ''));
const isCited = (spec) =>
  cited.has(spec)
  || citedBare.has(spec.split('/').pop())
  || globPrefixes.some((g) => spec === g || spec.startsWith(g));

const allowed = new Set(UNDOCUMENTED);
const undocumented = [...have].filter((h) => !isCited(h) && !allowed.has(h)).sort();
const staleAllowance = UNDOCUMENTED.filter((n) => !have.has(n) || isCited(n)).sort();

console.log(`cited: ${cited.size}   on disk: ${have.size}   undocumented (known): ${UNDOCUMENTED.length}`);
if (missing.length || bareMissing.size || undocumented.length || staleAllowance.length) {
  if (missing.length) {
    console.error(`\nCITED BUT MISSING (${missing.length}):`);
    missing.forEach((m) => console.error('  ' + m));
  }
  if (bareMissing.size) {
    console.error(`\nCITED BUT MISSING — bare names in the spec column (${bareMissing.size}):`);
    [...bareMissing].sort().forEach((m) => console.error('  ' + m));
  }
  if (undocumented.length) {
    console.error(`\nON DISK BUT UNDOCUMENTED (${undocumented.length}) — give each a COVERAGE.md row:`);
    undocumented.forEach((m) => console.error('  ' + m));
  }
  if (staleAllowance.length) {
    console.error(`\nSTALE UNDOCUMENTED ALLOWANCE (${staleAllowance.length}) — now cited or gone; delete from UNDOCUMENTED:`);
    staleAllowance.forEach((m) => console.error('  ' + m));
  }
  process.exitCode = 1;
} else {
  console.log('every cited spec path exists, and every spec is cited.');
}
