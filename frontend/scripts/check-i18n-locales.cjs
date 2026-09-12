/* Locale integrity gate.
 *
 * check-i18n-keys.cjs already proves every t() call resolves against English.
 * This proves the *other* direction: that hi and mr actually carry those keys,
 * and that what they carry is usable. Three failure classes, each of which has
 * already shipped at least once:
 *
 *   1. Missing key      — i18next silently falls back to English, so a Marathi
 *                         user sees a page in two languages and nothing errors.
 *   2. Mixed script     — a Cyrillic 'а' (U+0430) sat inside the Devanagari
 *                         शेअर in mr/flatmates.json. It renders as "शेaर". No
 *                         tool catches this; it is invisible in review.
 *   3. Placeholder drift — if English has {{count}} and the translation drops
 *                         it, the sentence loses its number at runtime.
 *
 * Untranslated-but-identical values are reported as a warning, not a failure:
 * brand names legitimately match English and are allowlisted below.
 *
 * Usage: node scripts/check-i18n-locales.cjs
 */
const fs = require('fs');
const path = require('path');

const LOCALES = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const BASE = 'en';
const TARGETS = ['hi', 'mr'];

/* Values that are correct when identical to English — product and brand nouns,
   and strings that are pure interpolation or punctuation. Add sparingly: each
   entry is an assertion that the English word is the right word in Devanagari too. */
const SAME_AS_ENGLISH_OK = new Set([
  // An email example is a format illustration, not prose — the local part and
  // domain stay Latin in every language.
  'auth.emailPlaceholder',
  // Pure interpolation and a literal URL — nothing to translate in either.
  'society.calDayAria',
  'society.waUrlPlaceholder',
  'locality.pulseBuyerVal',
  // "BHK" is the standard Indian abbreviation and is written in Latin script in
  // Hindi and Marathi listings too — transliterating it would read as foreign.
  'locality.bhk',
  'ownerHub.bhk1',
  'ownerHub.bhk2',
  'ownerHub.bhk3',
  'ownerHub.bhk4',
  'flatmates.channelWhatsApp',
  'listProperty.fields.bhk',
  'listProperty.photosDocs.docsWhyVerifiedOwner',
  'misc1.contactWhatsappShort',
  'misc1.referWhatsApp',
  'misc.msgWhatsApp',
  'owner.whatsapp',
  'property.whatsapp',
  'visits.whatsapp',
  'misc.coSeekerPlusName',
  'misc.coSeekerPlusDoneTitle',
  'misc.coOwnerName',
  'misc.coOwnerDoneTitle',
  'misc.coOwnerProName',
  'misc.coOwnerProDoneTitle',
  'misc.prUpiVpa',
  'property.assuredTitle',
  'property.whatsapp',
  'property.gstPct',
  'property.gstSuffix',
  'property.livabilityScore',
]);

/* Devanagari text must not contain characters from these blocks. Latin is
   deliberately allowed — "EMI", "OTP", "GST", "BHK" and brand names are written
   in Latin inside otherwise-Devanagari copy, which is normal Indian usage. */
const FOREIGN_SCRIPTS = [
  [0x0400, 0x04ff, 'Cyrillic'],
  [0x0370, 0x03ff, 'Greek'],
  [0x0590, 0x05ff, 'Hebrew'],
  [0x0600, 0x06ff, 'Arabic'],
];

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

const placeholders = (s) =>
  (String(s).match(/\{\{\s*[\w.]+\s*\}\}/g) || []).map((p) => p.replace(/\s/g, '')).sort();

function foreignChars(s) {
  const hits = [];
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    for (const [lo, hi, name] of FOREIGN_SCRIPTS) {
      if (cp >= lo && cp <= hi) hits.push(`${ch} (U+${cp.toString(16).toUpperCase()}, ${name})`);
    }
  }
  return hits;
}

const base = flatten(loadBundle(BASE));
const baseKeys = Object.keys(base);
const errors = [];
const warnings = [];

for (const lang of TARGETS) {
  const target = flatten(loadBundle(lang));

  for (const key of baseKeys) {
    if (!(key in target)) {
      errors.push(`[${lang}] missing key: ${key}`);
      continue;
    }

    const value = target[key];
    if (typeof value !== 'string') continue;

    const foreign = foreignChars(value);
    if (foreign.length) {
      errors.push(`[${lang}] foreign script in ${key}: ${foreign.join(', ')}\n         value: ${value}`);
    }

    const want = placeholders(base[key]);
    const got = placeholders(value);
    if (want.join(',') !== got.join(',')) {
      errors.push(
        `[${lang}] placeholder mismatch in ${key}\n`
        + `         en: ${want.join(' ') || '(none)'}\n`
        + `         ${lang}: ${got.join(' ') || '(none)'}`,
      );
    }

    if (value === base[key] && !SAME_AS_ENGLISH_OK.has(key)
        && typeof base[key] === 'string' && /[a-zA-Z]{3}/.test(base[key]) && base[key].length > 3) {
      warnings.push(`[${lang}] untranslated (same as English): ${key} = ${JSON.stringify(value)}`);
    }
  }

  for (const key of Object.keys(target)) {
    if (!(key in base)) errors.push(`[${lang}] orphan key not in English: ${key}`);
  }
}

if (warnings.length) {
  console.warn(`\n${warnings.length} untranslated string(s):`);
  warnings.forEach((w) => console.warn(`  ${w}`));
  console.warn('  (Add to SAME_AS_ENGLISH_OK in this file if the English word is correct in Devanagari.)');
}

if (errors.length) {
  console.error(`\n${errors.length} locale error(s):`);
  errors.forEach((e) => console.error(`  ${e}`));
  process.exit(1);
}

console.log(`i18n locales OK — ${TARGETS.join(', ')} each carry all ${baseKeys.length} English keys, with matching placeholders and no mixed scripts.`);
