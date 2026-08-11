/**
 * Finance period window — the Indian FY pivot, and that there is only one of it (D178).
 *
 *   node scripts/check-finance-period.mjs
 *
 * No backend, no browser: this is a pure check of the arithmetic the Finances tab filters by.
 *
 * ## Why this file exists
 *
 * The owner's Finances screen used to carry **three** copies of "when does this period start":
 * the KPI strip took its totals from the server (`SummaryPeriods.startOf`, whose `year` pivots on
 * 1 April), the transaction table directly below it derived its own window and pivoted `year` on
 * 1 January, and `expenseBreakdown` did not implement `year` at all and silently showed all-time.
 * Between January and March those three answered the same question three different ways on one
 * screen. Nothing tied them together, so nothing noticed.
 *
 * ## What is asserted
 *
 *   1. **The pivot**, against hard-coded dates rather than against the implementation — so the
 *      assertion has an oracle independent of the code it checks.
 *   2. **The summary and the table agree**, over one fixture, at a fixed clock.
 *   3. **There is still only one copy** of the arithmetic in `frontend/src`.
 *
 * ## The probes are in January–March, deliberately
 *
 * A probe in, say, June cannot tell 1 April from 1 January: both pivots land in the same calendar
 * year and every assertion passes with the bug present. Only the Jan–Mar quarter separates them.
 *
 * Exit code 0 = the window is the server's, 1 = drift (suitable for CI).
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { periodStart, filterByPeriod, financeSummary, setTransactions } =
  await import('../src/lib/data/finances.js');

const failures = [];
let checks = 0;

function eq(actual, expected, what) {
  checks += 1;
  if (actual !== expected) failures.push(`${what}\n      expected: ${expected}\n      actual:   ${actual}`);
}

const iso = (d) => (d === null ? 'null' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);

/* ─── 1. The pivot ────────────────────────────────────────────────────────────────────────────
   Mirrors backend `SummaryPeriods.startOf`: before April we are still in the FY that began last
   April. The expected values below are written out, not computed — a test that derives its own
   expectation from the same rule it is checking cannot fail. */
console.log('\n  1. year → 1 April of the current Indian financial year');
[
  ['2026-01-15', '2025-04-01', 'January sits in the FY that began the previous April'],
  ['2026-02-15', '2025-04-01', 'February — the middle of the quarter that separates the two pivots'],
  ['2026-03-31', '2025-04-01', 'the last day of the FY still belongs to it'],
  ['2026-04-01', '2026-04-01', '1 April opens the new FY'],
  ['2026-11-20', '2026-04-01', 'November looks back to this April'],
].forEach(([today, expected, why]) => {
  eq(iso(periodStart('year', new Date(`${today}T12:00:00`))), expected, `year @ ${today} — ${why}`);
});

console.log('  2. month / quarter / all');
[
  ['month', '2026-02-15', '2026-02-01'],
  ['quarter', '2026-02-15', '2026-01-01'],
  ['quarter', '2026-05-02', '2026-04-01'],
  ['all', '2026-02-15', 'null'],
].forEach(([period, today, expected]) => {
  eq(iso(periodStart(period, new Date(`${today}T12:00:00`))), expected, `${period} @ ${today}`);
});

/* ─── 3. The card and the table agree ─────────────────────────────────────────────────────────
   One fixture, one clock, both readers. `MID_FY` is the row that separates the pivots: June 2025
   is inside the FY that began 1 April 2025, and outside the calendar year 2026. If the window ever
   pivots back to 1 January, the table drops it and the totals below fall by its amount. */
console.log('  3. summary totals == the rows the table lists');
const NOW = new Date('2026-02-15T12:00:00');
const MOB = '9812345670';
const PROP = 'p-fy-probe';
const FIXTURE = [
  { id: 't1', type: 'income', category: 'Rent received', amount: 25000, date: '2026-02-05' }, // this month
  { id: 't2', type: 'income', category: 'Rent received', amount: 25000, date: '2026-01-05' }, // this FY, this CY
  { id: 't3', type: 'income', category: 'Rent received', amount: 25000, date: '2025-06-05' }, // this FY, LAST CY
  { id: 't4', type: 'expense', category: 'Repairs', amount: 4000, date: '2025-09-10' }, // this FY, last CY
  { id: 't5', type: 'income', category: 'Rent received', amount: 25000, date: '2025-02-05' }, // PREVIOUS FY
];
setTransactions(MOB, PROP, FIXTURE);

const tableTotals = (period) => {
  const rows = filterByPeriod(FIXTURE, period, NOW);
  const sum = (type) => rows.filter((r) => r.type === type).reduce((s, r) => s + r.amount, 0);
  return { income: sum('income'), expense: sum('expense'), count: rows.length };
};

['all', 'month', 'quarter', 'year'].forEach((period) => {
  const card = financeSummary(MOB, PROP, period, NOW);
  const table = tableTotals(period);
  eq(card.income, table.income, `${period}: KPI income vs the rows listed below it`);
  eq(card.expense, table.expense, `${period}: KPI expense vs the rows listed below it`);
  eq(card.count, table.count, `${period}: KPI row count vs the rows listed below it`);
});

/* The absolute numbers, so the agreement above cannot be two readers being wrong together. */
const year = financeSummary(MOB, PROP, 'year', NOW);
eq(year.income, 75000, 'year @ Feb 2026: the three rents on or after 1 Apr 2025, not the two since 1 Jan 2026');
eq(year.expense, 4000, 'year @ Feb 2026: the Sept 2025 repair is inside this FY');
eq(tableTotals('year').count, 4, 'year @ Feb 2026: four rows, and Feb 2025 is not one of them');

/* ─── 4. Still only one copy ──────────────────────────────────────────────────────────────────
   The bug was not that the arithmetic was wrong in one place; it was that it existed in three, and
   nothing said so out loud. Two other FY pivots do live in the tree — the tenant Rent Wallet's
   `fyStart` and the rent receipt's FY label — and both are correct and answer a different question
   (a wallet window and a printed label, not the owner ledger's period selector). They are pinned by
   name here rather than banned, so a *fourth* copy cannot appear unannounced. */
console.log('  4. one copy of the period window, and no 1-January pivot anywhere');
const { readdirSync, readFileSync } = await import('node:fs');
const { join, relative } = await import('node:path');

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  return e.isDirectory() ? walk(p) : (/\.jsx?$/.test(e.name) ? [p] : []);
});
const rel = (p) => relative(SRC, p).replace(/\\/g, '/');

/* The owner Finances screen's window lives here and nowhere else. The other two answer different
   questions and are listed so the count below is a statement, not an accident. */
const KNOWN_FY_PIVOTS = [
  'lib/data/finances.js',       // periodStart — the owner ledger's period selector (this file's subject)
  'lib/data/tenantFinance.js',  // fyStart — the tenant Rent Wallet's HRA year
  'lib/data/rentReceiptGen.js', // fyStart — the FY label printed on a rent receipt
];

const fyPivots = [];
const calendarYearPivots = [];
walk(SRC).forEach((file) => {
  const text = readFileSync(file, 'utf8');
  if (/getMonth\(\)\s*>=\s*3/.test(text)) fyPivots.push(rel(file));
  if (/new Date\(\s*now\.getFullYear\(\)\s*,\s*0\s*,\s*1\s*\)/.test(text)) calendarYearPivots.push(rel(file));
});

eq(fyPivots.sort().join(', '), [...KNOWN_FY_PIVOTS].sort().join(', '),
  'files carrying a financial-year pivot — a new one means the arithmetic has been copied again');
eq(calendarYearPivots.length, 0,
  `files pivoting a period window on 1 January: ${calendarYearPivots.join(', ') || 'none'}`);

/* ─── Result ──────────────────────────────────────────────────────────────────────────────── */
if (failures.length) {
  console.error(`\n  ✖ ${failures.length} of ${checks} checks failed\n`);
  failures.forEach((f) => console.error(`    - ${f}`));
  console.error('');
  process.exit(1);
}
console.log(`\n  ✔ ${checks} checks passed — the client's period window is the server's\n`);
