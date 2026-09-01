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
 */
import { getFaqs } from '../../../lib/mockApi.js';

/** Every published FAQ, in the server's vocabulary. */
export async function listFaqs() {
  const rows = await getFaqs();
  return (Array.isArray(rows) ? rows : []).map((f) => ({
    id: String(f?.id || ''),
    question: String(f?.q || ''),
    answer: String(f?.a || ''),
    category: String(f?.cat || ''),
  }));
}
