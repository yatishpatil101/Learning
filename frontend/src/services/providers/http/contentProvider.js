/**
 * HTTP content provider.
 *
 * `GET /faqs` (public, no `Authorization`).
 *
 * The response is a bare JSON array of `FaqResponse`, not a `PageResponse` — the whole published set
 * is a page's worth of copy and the server does not paginate it — so there is nothing to unwrap.
 *
 * Verified against `content/FaqResponse.java`, which is
 * `record FaqResponse(String id, String question, String answer, String category,
 * Map<String, Map<String, String>> translations)`, and `ContentService.listFaqs()`, which filters
 * archived rows server-side.
 */
import { get } from '../../http.js';

/**
 * Coerce one wire row into the service's shape.
 *
 * `String(... || '')` rather than a trusting spread because these strings are rendered directly into
 * the help page and fed to the assistant's tokenizer; a `null` answer would render as the word
 * "null" under a real question, which reads as a broken promise rather than as missing data.
 *
 * Nothing is dropped and nothing is renamed: the server's fields are the service's fields.
 * A row is passed through even if its `category` is empty, because category is a grouping hint the
 * help page does not currently use and an answer is worth showing without one.
 *
 * `translations` is copied through as an object rather than flattened into `question_mr` and
 * friends (D2). Flattening would have made this file the only place that knew the languages, so
 * adding Hindi later would have meant editing a provider to ship a translation an editor had
 * already written. It is defaulted to `{}` rather than left undefined so `lib/contentLang.js` can
 * read `record.translations[lang]` without a guard, and so the shape does not change depending on
 * whether the server happens to be new enough to send it.
 */
const toFaq = (row) => ({
  id: String(row?.id || ''),
  question: String(row?.question || ''),
  answer: String(row?.answer || ''),
  category: String(row?.category || ''),
  translations: row?.translations && typeof row.translations === 'object' ? row.translations : {},
});

/** Every published FAQ. Public — no token, no session short-circuit. */
export async function listFaqs() {
  const rows = await get('/faqs');
  return (Array.isArray(rows) ? rows : []).map(toFaq);
}
