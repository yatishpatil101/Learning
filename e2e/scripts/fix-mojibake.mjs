/* Repairs mojibake (UTF-8 decoded as CP1252, re-encoded) and UTF-8 BOMs — both fingerprints of
   PowerShell `Set-Content` / `>` on a source file. General algorithm, not a table of known damage. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/* `DRY=1 node …` reports what it would change, and shows the first changed line
   of each file, without writing. Several of the target files carry uncommitted
   work, so "revert and retry" is not available — inspect first. */
const DRY = process.env.DRY === '1';

const EXTENSIONS = /\.(java|js|jsx|ts|tsx|mjs|cjs|sql|py|css|scss|html|json|yaml|yml|md)$/;

const EXCLUDE = new Set([
  'e2e/scripts/fix-mojibake.mjs',
  'e2e/scripts/scan-encoding.mjs',
]);

/* CP1252 differs from Latin-1 only in 0x80-0x9F, where it has typographic characters instead of
   control codes. Those 27 are what make mojibake look like mojibake — the euro sign in the em-dash
   sequence is 0x80 — so without this table the algorithm misses most sequences. */
const CP1252_HIGH = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/** The CP1252 byte for a code point, or null if CP1252 cannot represent it. */
function toByte(code) {
  if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code;
  const mapped = CP1252_HIGH[code];
  return mapped === undefined ? null : mapped;
}

const decoder = new TextDecoder('utf-8');

/* Bounding a run to **non-ASCII** characters is the correctness condition, not an optimisation: one
   undecodable byte rejects a whole run, so a run that absorbed ASCII would let a single stray
   character protect an entire file. No UTF-8 multi-byte sequence contains a byte below 0x80, so
   splitting on ASCII has no false negatives. */
function repair(text) {
  let out = '';
  let i = 0;
  let fixed = 0;
  while (i < text.length) {
    const code = text.codePointAt(i);
    const byte = code < 0x80 ? null : toByte(code);
    if (byte === null) {
      // ASCII, or something CP1252 cannot represent — either way, not mojibake.
      out += text[i];
      i += 1;
      continue;
    }
    const start = i;
    const bytes = [];
    while (i < text.length) {
      const c = text.codePointAt(i);
      if (c < 0x80) break;
      const b = toByte(c);
      if (b === null) break;
      bytes.push(b);
      i += 1;
    }
    const run = text.slice(start, i);
    const decoded = decoder.decode(Uint8Array.from(bytes));
    if (!decoded.includes('\uFFFD') && decoded.length < run.length) {
      out += decoded;
      fixed += run.length - decoded.length;
    } else {
      out += run;
    }
  }
  return { out, fixed };
}

const files = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 1e8 })
  .split('\n')
  .map((f) => f.trim())
  .filter((f) => EXTENSIONS.test(f) && !EXCLUDE.has(f));

if (files.length === 0) {
  throw new Error('No tracked source files found — run this from the repository root.');
}

let touched = 0;
let debommed = 0;
for (const rel of files) {
  const path = new URL('../../' + rel, import.meta.url);
  let before;
  try {
    before = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  const { out, fixed } = repair(before);
  let after = out;
  if (after.charCodeAt(0) === 0xfeff) {
    after = after.slice(1);
    debommed += 1;
  }
  if (after !== before) {
    // 'utf8' writes no BOM, and every byte we did not match round-trips unchanged
    // — including CRLF line endings.
    if (!DRY) writeFileSync(path, after, 'utf8');
    touched += 1;
    console.log(`  ${String(fixed).padStart(4)}  ${rel}`);
    if (DRY) {
      // Show the first changed line so the diff can be judged before it is written.
      const b = before.split(/\r?\n/);
      const a = after.split(/\r?\n/);
      for (let n = 0; n < Math.min(b.length, a.length); n += 1) {
        if (b[n] !== a[n]) {
          console.log(`        - ${b[n].trim().slice(0, 110)}`);
          console.log(`        + ${a[n].trim().slice(0, 110)}`);
          break;
        }
      }
    }
  }
}
console.log(`\n${touched} files ${DRY ? 'WOULD BE' : ''} repaired, ${debommed} BOMs stripped, out of ${files.length} scanned.`);
