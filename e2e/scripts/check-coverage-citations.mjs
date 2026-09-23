/* Check that COVERAGE.md and the suite on disk describe each other — in both directions.
 *
 * Every spec path cited in COVERAGE.md must exist, because a stale name reads as coverage that is
 * not there. And every spec on disk must be cited, because an undocumented spec is worse: it is
 * coverage the matrix cannot tell you about, and nothing goes red. Worth re-running whenever specs
 * move or are added.
 */
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

/* Cited spec paths look like `consumer/home/featured`. Anchor on the real
   top-level test folders, and reject anything preceded by a slash: without both
   guards, app routes (`/admin/team`, `/services/rent-agreement`), source paths
   (`lib/chrome`) and plain prose ("role/flag/team") all read as citations.

   Rows the doc marks `(retired …)` are skipped. The table at the foot of this file is a record of
   what each closed item *taught*, so it names specs that were deliberately deleted — citing them
   is the point. Counting those as gaps left this script permanently red, which is the one state a
   gate must never sit in: a red it is meant to have, and so a red nobody reads. */
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

/* Second pass: bare citations, which the scan above cannot see.
 *
 * Many specs are cited without their folder (`live-my-rental`, `maker-checker`, `emi-calculator`),
 * and the path regex requires at least one slash — so a *bare* citation would never be validated
 * at all, and this script would keep reporting "every cited spec path exists" after one of them
 * was deleted. A gate that answers green on a question it never asked is worse than no gate,
 * because the doc's header promises it did ask.
 *
 * Two things make this pass tolerable rather than noisy. It is scoped to the **spec column** —
 * the last-but-one cell of a status row — because bare names cannot be told from prose anywhere
 * else ("saved", "refer" and "finance" are all ordinary English in this document). And within
 * that cell everything from the first prose marker onward is discarded, since citations lead and
 * commentary follows: `live-listing-entitlements ("taking a listing down frees its slot")` is one
 * citation, not a citation plus four words. A bare name resolves against spec *basenames*, which
 * is what the doc's own convention means by it.
 */
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

/* Third pass, and the other direction entirely.
 *
 * Everything above answers "does every cited spec exist?". Nothing answered "is every spec cited?",
 * and that is the quieter of the two failures: a stale citation is at least a name somebody can
 * look up and find missing, whereas an *undocumented* spec is invisible — the matrix reads complete,
 * and the only way to notice is to count the files yourself. A spec can be deleted or written
 * without this matrix reacting, and the header's promise that it is the index of the suite is what
 * makes the second one a lie rather than an omission.
 *
 * The entries below are the specs this matrix does not yet document. They are listed rather than
 * tolerated by a count, so each one has to be deleted from this array by hand when its row lands —
 * and the check is **two-way**: an entry that is now cited, or that no longer exists, fails the
 * gate too. That is the whole point. An allowlist that only ever suppresses becomes permanent the
 * day it is written; one that goes red when you fix something is a worklist that empties itself
 * and then, at zero, can be deleted along with this paragraph.
 */
const UNDOCUMENTED = [
  'consumer/account/live-faq-translations',
  'consumer/account/live-faqs',
  'consumer/account/live-listing-freshness',
  'consumer/live-localities',
  'consumer/live-reels',
  'consumer/live-trust-counters',
  'consumer/property/owner-preview',
  'consumer/property/signin-gates',
  'consumer/services/live-interior-lead',
  'consumer/services/live-move-in-pack-waitlist',
  'live-admin-content',
  'live-admin-services',
  'live-demand-signals',
  'live-service-landing-ticket',
  'platform/live-assistant',
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
