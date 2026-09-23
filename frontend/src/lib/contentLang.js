/* Admin-editable copy (FAQs, banners, announcements) carries its translations on the record, nested
   under `translations` keyed by language, so it cannot live in src/i18n/locales.

   A missing translation falls back to the base field **per field, not per record**: a row with a
   Marathi question and an untranslated answer renders both rather than discarding the question. */

const SUPPORTED = new Set(['hi', 'mr']);

/** Normalise an i18next tag (`mr-IN`, `HI`) to a key this module understands. */
export function contentLang(lang) {
  const short = String(lang || 'en').toLowerCase().split('-')[0];
  return SUPPORTED.has(short) ? short : 'en';
}

/* An empty string in a translation is treated as absent: an editor who cleared the box meant
   "not translated", so English shows instead of a blank. */
export function localizedField(record, field, lang) {
  if (!record) return '';
  const base = record[field] ?? '';
  const short = contentLang(lang);
  if (short === 'en') return base;
  return record.translations?.[short]?.[field] || base;
}

/* Returns a new object — the record is left alone. */
export function localizeRecord(record, fields, lang) {
  if (!record) return record;
  const out = { ...record };
  for (const field of fields) out[field] = localizedField(record, field, lang);
  return out;
}
