/* i18n coverage audit.
 *
 * Reports three things the app cannot see at runtime:
 *   1. Key parity  — keys present in English but missing from hi/mr.
 *   2. Untranslated — keys present in hi/mr whose value is byte-identical to English.
 *   3. Adoption    — JSX files rendering visible text with no useTranslation() call.
 *
 * The third is a heuristic, not a proof: it looks for literal text between JSX
 * tags and in user-facing attributes. It over-reports on files whose only text is
 * a class name or an icon label, so treat the list as a work queue rather than a
 * defect count.
 *
 * Usage: node scripts/i18n-report.cjs [--area=pages/admin] [--list]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const LOCALES = path.join(ROOT, 'i18n', 'locales');
const LANGS = ['hi', 'mr'];

const args = process.argv.slice(2);
const areaFilter = (args.find((a) => a.startsWith('--area=')) || '').slice(7);
const showList = args.includes('--list');

function loadBundle(lang) {
  const dir = path.join(LOCALES, lang);
  const bundle = {};
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    Object.assign(bundle, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  return bundle;
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsx')) out.push(p);
  }
  return out;
}

/* ── 1 + 2: parity and untranslated ───────────────────────────────────────── */

const en = flatten(loadBundle('en'));
const enKeys = Object.keys(en);

console.log(`\nEnglish bundle: ${enKeys.length} keys\n`);
console.log('KEY PARITY');
console.log('─'.repeat(72));

const gaps = {};
for (const lang of LANGS) {
  const t = flatten(loadBundle(lang));
  const missing = enKeys.filter((k) => !(k in t));
  // A value identical to English is usually an untranslated placeholder. Proper
  // nouns and numerals legitimately match, so short and non-alphabetic values
  // are excluded to keep the signal usable.
  const identical = enKeys.filter((k) =>
    k in t && t[k] === en[k] && typeof en[k] === 'string' && en[k].length > 3 && /[a-zA-Z]{3}/.test(en[k]));
  gaps[lang] = { missing, identical };

  const done = enKeys.length - missing.length - identical.length;
  const pct = ((done / enKeys.length) * 100).toFixed(1);
  console.log(`${lang}  translated ${done}/${enKeys.length} (${pct}%)  missing ${missing.length}  same-as-en ${identical.length}`);
}

if (showList) {
  for (const lang of LANGS) {
    if (gaps[lang].missing.length) {
      console.log(`\n  ${lang} missing keys:`);
      gaps[lang].missing.forEach((k) => console.log(`    ${k}`));
    }
    if (gaps[lang].identical.length) {
      console.log(`\n  ${lang} untranslated (same as English):`);
      gaps[lang].identical.forEach((k) => console.log(`    ${k} = ${JSON.stringify(en[k]).slice(0, 60)}`));
    }
  }
}

/* ── 3: adoption ──────────────────────────────────────────────────────────── */

// Text between JSX tags: >Some words< — at least two letters, not an expression.
const JSX_TEXT = />[ \t]*([A-Z][A-Za-z][^<>{}\n]{2,})[ \t]*</g;
// User-visible string attributes.
const JSX_ATTR = /\b(?:placeholder|title|aria-label|alt)=["']([^"'{}\n]{3,})["']/g;

const files = walk(ROOT)
  .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
  .filter((f) => !areaFilter || f.startsWith(areaFilter));

const rows = [];
for (const rel of files) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const translated = /useTranslation|react-i18next|<Trans\b/.test(src);
  const literals = new Set();
  for (const m of src.matchAll(JSX_TEXT)) literals.add(m[1].trim());
  for (const m of src.matchAll(JSX_ATTR)) literals.add(m[1].trim());
  if (!translated && literals.size > 0) rows.push({ rel, count: literals.size, samples: [...literals].slice(0, 3) });
}

rows.sort((a, b) => b.count - a.count);

const byArea = {};
for (const r of rows) {
  const area = r.rel.split('/').slice(0, 2).join('/');
  byArea[area] = (byArea[area] || 0) + r.count;
}

console.log(`\n\nADOPTION — files with visible text and no useTranslation()`);
console.log('─'.repeat(72));
console.log(`${rows.length} files, ~${rows.reduce((n, r) => n + r.count, 0)} literal strings\n`);
Object.entries(byArea)
  .sort((a, b) => b[1] - a[1])
  .forEach(([area, n]) => console.log(`  ${String(n).padStart(5)}  ${area}`));

if (showList) {
  console.log('\n  Worst offenders:');
  rows.slice(0, 40).forEach((r) => {
    console.log(`    ${String(r.count).padStart(4)}  ${r.rel}`);
    console.log(`          e.g. ${r.samples.map((s) => JSON.stringify(s.slice(0, 40))).join(', ')}`);
  });
}

console.log('');
