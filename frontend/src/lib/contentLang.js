/* Language resolution for admin-editable content.
 *
 * Some copy is not a UI string in a locale bundle — FAQs, banners and
 * announcements are records an admin edits at runtime, so they cannot live in
 * src/i18n/locales. They carry optional per-language fields instead:
 *
 *     { q: "Is it free?", q_hi: "क्या यह मुफ़्त है?", q_mr: "हे मोफत आहे का?" }
 *
 * A missing translation falls back to the base field, matching how help articles
 * behave (see lib/help.js). That way a newly written FAQ is visible to everyone
 * immediately and gets translated afterwards, rather than being invisible to
 * Hindi and Marathi readers until someone remembers to translate it.
 */

const SUPPORTED = new Set(['hi', 'mr']);

/** Normalise an i18next tag (`mr-IN`, `HI`) to a suffix this module understands. */
export function contentLang(lang) {
  const short = String(lang || 'en').toLowerCase().split('-')[0];
  return SUPPORTED.has(short) ? short : 'en';
}

/**
 * Read `field` from `record` in the given language, falling back to English.
 *
 * @param {object} record
 * @param {string} field
 * @param {string} lang i18next language tag
 */
export function localizedField(record, field, lang) {
  if (!record) return '';
  const short = contentLang(lang);
  if (short === 'en') return record[field] ?? '';
  return record[`${field}_${short}`] ?? record[field] ?? '';
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
