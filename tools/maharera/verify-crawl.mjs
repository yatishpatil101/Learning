/**
 * Proves the name crawl is complete rather than assuming it.
 *
 * The previous run finished "successfully" while silently missing ~19 pages, so a row count alone
 * is not evidence. Each row now carries the page that produced it, which makes a gap provable:
 * every page in 1..4943 must appear, and every page but the last must have contributed 10 rows.
 */
import { readFileSync } from 'node:fs';

const rows = readFileSync('data/maharera/list-rows.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const byPage = new Map();
let unstamped = 0;
for (const r of rows) {
  if (r.page == null) { unstamped++; continue; }
  byPage.set(r.page, (byPage.get(r.page) ?? 0) + 1);
}

const TOTAL_PAGES = 4943;
const missing = [];
const short = [];
for (let p = 1; p <= TOTAL_PAGES; p++) {
  const n = byPage.get(p) ?? 0;
  if (n === 0) missing.push(p);
  else if (n < 10 && p !== TOTAL_PAGES) short.push(`${p}:${n}`);
}

const ids = new Set(rows.map((r) => r.rera));
const named = rows.filter((r) => r.projectName).length;
const pune = new Set(rows.filter((r) => r.district === 'Pune').map((r) => r.rera));

console.log(`rows in file:      ${rows.length.toLocaleString()} (unstamped from the old run: ${unstamped.toLocaleString()})`);
console.log(`unique RERA ids:   ${ids.size.toLocaleString()}`);
console.log(`with project name: ${named.toLocaleString()}`);
console.log(`Pune ids:          ${pune.size.toLocaleString()}`);
console.log(`pages seen:        ${byPage.size.toLocaleString()} / ${TOTAL_PAGES}`);
console.log(`last page rows:    ${byPage.get(TOTAL_PAGES) ?? 0}`);
console.log(`MISSING pages:     ${missing.length}${missing.length ? ' -> ' + missing.slice(0, 40).join(',') : ''}`);
console.log(`SHORT pages:       ${short.length}${short.length ? ' -> ' + short.slice(0, 40).join(',') : ''}`);
