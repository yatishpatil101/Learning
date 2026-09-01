/**
 * Content Service — the editorial copy the platform publishes about itself.
 *
 * `GET /faqs` (public).
 *
 * ## Why this domain is one method wide
 *
 * `ContentController` exposes four public reads — `/announcements`, `/services`, `/faqs`,
 * `/banners` — and only FAQs can be moved across today. The other three are recorded rather than
 * built, because each is blocked on something that is not a migration:
 *
 * - **banners** cannot round-trip. `BannerResponse` carries `{ id, image, link, headline, position }`
 *   and the mock's banners carry a `cta` and a `theme` the server has no column for. Moving the
 *   consumer onto the server would silently drop copy that is currently rendered.
 * - **announcements** and **services** have no consumer a *public read* can serve. Their only
 *   caller is the admin content console, which asks for archived rows and then writes — and there
 *   are no admin content routes at all, in either direction.
 *
 * So this file will grow, and it is deliberately not shaped as though it already had.
 *
 * ## Shape
 *
 *   { id, question, answer, category }
 *
 * **The server's field names, not the mock's.** The mock stores `q` / `a` / `cat`, and the temptation
 * is to keep that here and translate on the way in — the diff would be smaller. It would also make
 * this seam a permanent dialect: every future reader would learn the abbreviations, and the wire
 * shape would be something only one file had ever seen. The seam exists to make the server's
 * vocabulary the application's vocabulary, so the translation goes in the mock provider, which is
 * the side with an expiry date.
 *
 * ## What this deliberately does not promise
 *
 * **No order.** `ContentService.listFaqs()` is `findByArchivedFalse()` with no `Sort`, so the rows
 * arrive in whatever order Postgres finds them in — stable for a freshly seeded table, and not
 * guaranteed across an update. The mock's order was editorial (the zero-brokerage answer first,
 * because it is the platform's core claim). Sorting here would hide that the guarantee is missing
 * rather than supply it; the fix is a `position` column on the server, exactly as `banners` already
 * has. Recorded in `tasks/todo.md`, and no caller may rely on index.
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
