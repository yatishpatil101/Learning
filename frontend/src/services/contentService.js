/**
 * Content Service — the editorial copy the platform publishes about itself, and what readers say
 * back about it.
 *
 * `GET /faqs` and `POST /help/feedback` (both public).
 *
 * ## Why the read side is one method wide
 *
 * `ContentController` exposes four public reads — `/announcements`, `/services`, `/faqs`,
 * `/banners` — and only FAQs can be moved across today. The other three are recorded rather than
 * built, because each is blocked on something that is not a migration:
 *
 * - **banners** cannot round-trip. `BannerResponse` carries `{ id, image, link, headline, position }`
 *   with no column for a `cta` or a `theme`, so a consumer moved onto the server would silently
 *   drop copy that is currently rendered.
 * - **announcements** and **services** have no consumer a *public read* can serve. Their only
 *   caller is the admin content console, which asks for archived rows and then writes.
 *
 * `AdminContentController` covers all four types at `/admin/content/{type}` — list (including
 * archived), create, patch, archive, restore. That is a different seam on purpose: the console
 * needs archived rows and a write path, and this is the public read. See `adminContentService.js`.
 *
 * ## Shape
 *
 *   { id, question, answer, category }
 *
 * The FAQ row; help feedback has no read and therefore no shape to state. **The server's field
 * names.** Abbreviations (`q` / `a` / `cat`) translated at this seam would make it a permanent
 * dialect only one file had ever seen — the seam exists to make the server's vocabulary the
 * application's.
 *
 * **No order is promised.** `ContentService.listFaqs()` is `findByArchivedFalse()` with no `Sort`,
 * so rows arrive in whatever order Postgres finds them in — stable for a freshly seeded table, not
 * guaranteed across an update. Sorting here would hide the missing guarantee rather than supply it;
 * the fix is a `position` column on the server, as `banners` already has. Recorded in
 * `tasks/todo.md`, and no caller may rely on index.
 */
import { createProvider } from './config.js';

const provider = createProvider('content');

/**
 * Every published FAQ.
 *
 * **Public** — the help page and the assistant both have to answer a signed-out visitor, which is
 * most of the people who have a question. No token, no short-circuit on a missing session.
 *
 * Archived entries are excluded by the server, and the caller has no way to ask for them: retiring
 * an answer is how editorial copy is withdrawn, and a consumer surface that could still render a
 * withdrawn answer would make the withdrawal decorative.
 *
 * @returns {Promise<{id: string, question: string, answer: string, category: string}[]>}
 */
export const listFaqs = async () => (await provider()).listFaqs();

/**
 * Record whether a help article helped. Public, and write-only — there is no read to pair with it.
 *
 * A reader who *is* signed in is recorded as such, so "owners find this confusing" can be told
 * apart from "nobody understands it". Erasure reaches both the link and the prose.
 *
 * @param {{slug: string, lang: string, helpful: boolean, comment?: string}} verdict
 * @returns {Promise<void>}
 */
export const submitHelpFeedback = async (verdict) => (await provider()).submitHelpFeedback(verdict);
