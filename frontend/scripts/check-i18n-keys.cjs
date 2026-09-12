/* Every t('a.b.c') in the app must resolve against the English bundle.
   A missing key is silent at runtime — i18next renders the key itself — which is
   how "home.flatmates.headingLead" shipped as visible copy on the home page after
   the Share-a-Flat rename moved the JSX but not the JSON. Interpolated keys
   cannot be checked statically and are skipped — the runtime guard for those is
   the "no unresolved i18n keys" assertion in the home specs, which fails on any
   visible text shaped like a key. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const localeDir = path.join(root, 'i18n', 'locales', 'en');

const bundle = {};
for (const f of fs.readdirSync(localeDir).filter((n) => n.endsWith('.json'))) {
  Object.assign(bundle, JSON.parse(fs.readFileSync(path.join(localeDir, f), 'utf8')));
}

const has = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), bundle) !== undefined;

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.jsx?$/.test(e.name)) files.push(p);
  }
})(root);

const missing = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  // The trailing [,)] is what distinguishes a complete key argument from the
  // literal half of a concatenation like t('a.b.' + kind), which is dynamic.
  for (const m of src.matchAll(/\b(?:t|tr)\(\s*'([a-zA-Z][\w.]*\.[\w.]+)'\s*[,)]/g)) {
    // Plural and context suffixes are resolved by i18next at runtime.
    const key = m[1];
    if (has(key) || has(key + '_one') || has(key + '_other')) continue;
    missing.push(`${path.relative(root, file)}  ${key}`);
  }
}

if (missing.length) {
  console.error(`${missing.length} unresolved i18n key(s):\n` + missing.join('\n'));
  process.exit(1);
}
console.log(`i18n OK — every static t() key resolves (${files.length} files scanned).`);
