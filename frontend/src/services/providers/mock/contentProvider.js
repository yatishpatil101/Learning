/**
 * Mock content provider — the localStorage counterpart to `providers/http/contentProvider.js`.
 *
 * Reads the seeded `faqs` collection through the same getter the admin content console uses, so the
 * help page and the console keep agreeing about what is published while both exist.
 *
 * ## The one deliberate difference, and it is the point of the file
 *
 * **The mock stores `q` / `a` / `cat`; this returns `question` / `answer` / `category`.** The
 * abbreviations are the shape `db.json` has always had and the shape the two consumers used to read
 * directly. Translating here rather than at the call sites is what lets the seam have a single
 * vocabulary — the server's — without a rename rippling into a data file that is due to be deleted.
 * When the mock goes, this file goes with it and nothing downstream notices.
 *
 * Archived rows are excluded, matching the server's `findByArchivedFalse()`. The getter takes an
 * `includeArchived` option and it is deliberately not passed: there is no consumer route on which a
 * withdrawn answer should still render, and the admin console that legitimately wants them sits on
 * the mock API directly rather than behind this seam.
 *
 * Order is `db.json` order, which is editorial. The live endpoint has no order at all — see
 * `contentService.js` — so this is one of the differences that is honestly a difference, and no test
 * pins it on either side.
 *
 * ## Translations are converted here too, for the same reason the field names are
 *
 * `data/faqs.json` keeps them as suffixed fields — `q_mr`, `a_hi` — and the server keeps them nested
 * under `translations` (D2). Converting here rather than teaching the consumer both shapes is the
 * same call this file already makes about `q` vs `question`, and for the same reason: the seam has
 * one vocabulary, the server's, and the side with an expiry date is the side that adapts.
 *
 * Note that the suffix carries the *mock's* field name and the nested key carries the *wire* name,
 * so this is a rename as well as a reshape — `q_mr` becomes `translations.mr.question`. Doing it in
 * one table beats doing it twice in a reader that has to guess which vocabulary it is holding.
 */
import { getFaqs } from '../../../lib/mockApi.js';

/** Mock suffix -> wire field name. The order of the two halves is the whole conversion. */
const FIELDS = [['q', 'question'], ['a', 'answer'], ['cat', 'category']];
const LANGS = ['hi', 'mr'];

/**
 * Gather `q_mr`, `a_mr`, ... into `{ mr: { question, answer } }`.
 *
 * A language with no translated field at all is left out entirely rather than emitted as an empty
 * object, so `translations.mr` being present means something was actually written in Marathi.
 */
function nest(f) {
  const out = {};
  for (const lang of LANGS) {
    const one = {};
    for (const [suffix, wire] of FIELDS) {
      const v = f?.[`${suffix}_${lang}`];
      if (v) one[wire] = String(v);
    }
    if (Object.keys(one).length) out[lang] = one;
  }
  return out;
}

/** Every published FAQ, in the server's vocabulary. */
export async function listFaqs() {
  const rows = await getFaqs();
  return (Array.isArray(rows) ? rows : []).map((f) => ({
    id: String(f?.id || ''),
    question: String(f?.q || ''),
    answer: String(f?.a || ''),
    category: String(f?.cat || ''),
    translations: nest(f),
  }));
}
