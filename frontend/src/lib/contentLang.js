/* Language resolution for admin-editable content.
 *
 * Some copy is not a UI string in a locale bundle — FAQs, banners and
 * announcements are records an admin edits at runtime, so they cannot live in
 * src/i18n/locales. They carry their translations on the record itself, nested
 * under a `translations` object keyed by language (D2):
 *
 *     { question: "Is it free?",
 *       translations: { mr: { question: "हे मोफत आहे का?" } } }
 *
 * Nested rather than suffixed (`question_mr`, `question_hi`) because adding a
 * language is then data rather than three more columns per record, and because
 * one row's Marathi is one object rather than three fields nothing keeps in
 * step. `data/faqs.json` still stores the suffixed shape; the mock content
 * provider converts it, so this module only ever sees one shape.
 *
 * A missing translation falls back to the base field, matching how help articles
 * behave (see lib/help.js). That way a newly written FAQ is visible to everyone
 * immediately and gets translated afterwards, rather than being invisible to
 * Hindi and Marathi readers until someone remembers to translate it.
 *
 * The fallback is **per field, not per record**: a row with a Marathi question
 * and no Marathi answer renders the Marathi question above the English answer.
 * Falling back wholesale would throw away a translation somebody wrote, and
 * partly-translated is the state real editorial work spends most of its time in.
 */

const SUPPORTED = new Set(['hi', 'mr']);

/** Normalise an i18next tag (`mr-IN`, `HI`) to a key this module understands. */
export function contentLang(lang) {
  const short = String(lang || 'en').toLowerCase().split('-')[0];
  return SUPPORTED.has(short) ? short : 'en';
}

/**
 * Read `field` from `record` in the given language, falling back to English.
 *
 * An empty string in a translation is treated as absent: an editor who cleared
 * the box meant "not translated", not "translated to nothing".
 *
 * @param {object} record
 * @param {string} field
 * @param {string} lang i18next language tag
 */
export function localizedField(record, field, lang) {
  if (!record) return '';
  const base = record[field] ?? '';
  const short = contentLang(lang);
  if (short === 'en') return base;
  return record.translations?.[short]?.[field] || base;
}

/**
 * Project a record into a given language, replacing each named field with its
 * translation where one exists. Returns a new object — the record is left alone.
 *
 * @param {object} record
 * @param {string[]} fields
 * @param {string} lang
 */
export function localizeRecord(record, fields, lang) {
  if (!record) return record;
  const out = { ...record };
  for (const field of fields) out[field] = localizedField(record, field, lang);
  return out;
}
