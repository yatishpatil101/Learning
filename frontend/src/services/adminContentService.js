/**
 * Admin Content Service - the CMS authoring side of the four managed content lists.
 *
 * `{type}` (`announcements`, `services`, `faqs`, `banners`) discriminates the whole shape, so there
 * is one flat `ContentItem` rather than four schemas.
 *
 * Separate from `contentService`, which is the public read: the public reads never return archived
 * rows and must not say whether one exists, while this surface has an Archived tab as a first-class
 * feature. Folded together they would be one module whose return shape depended on who was asking.
 *
 * The server's field names are the only ones:
 * - **banners** `{ headline, image, link, position }` — no CTA label, no theme, no active flag.
 * - **faqs** `{ question, answer, category }` — no `q`/`a`/`cat` abbreviations, and withdrawal is
 *   `archive`, not `active: false`.
 * - **announcements** `{ title, body, severity, startsAt, endsAt, active }` — no audience column.
 *
 * PATCH is merge, POST is not: `update` sends only changed fields and the server treats `null` as
 * "leave alone", because the editor renders one type's fields at a time and replace semantics would
 * blank whatever the open form did not happen to show. `translations` is the exception and is
 * replaced whole — a merge would leave a deleted translation undeletable.
 */
import { createProvider } from './config.js';

const provider = createProvider('adminContent');

/** The four types the API manages. Anything else is a 400 from the server, not a silent empty list. */
export const CONTENT_TYPES = ['announcements', 'services', 'faqs', 'banners'];

/**
 * Fields the server owns, stripped out of every write body.
 *
 * The console's edit modal is seeded with the whole row, and posting that back hands the server four
 * fields `ContentWrite` does not accept — `archived` in particular would be a second, unaudited way
 * to archive a row, competing with the endpoint that exists to do exactly that.
 *
 * Filtered here rather than in the page, because the rule is about the API's write contract and not
 * about one form; and here rather than in the providers, because both transports have to obey it.
 */
const SERVER_OWNED = ['id', 'type', 'archived', 'createdAt'];

const writable = (body) => {
  const out = { ...(body || {}) };
  SERVER_OWNED.forEach((k) => { delete out[k]; });
  return out;
};

/**
 * Every row of one type, archived ones included and told apart by `archived` rather than fetched
 * separately — the console shows both at once, and two requests would let the two halves disagree
 * about the same row mid-edit.
 *
 * @param {string} type one of {@link CONTENT_TYPES}
 * @returns {Promise<object[]>} flat `ContentItem` rows; fields belonging to other types are null
 */
export const listContent = async (type) => (await provider()).listContent(type);

/**
 * Create a row. The server checks the per-type required fields and answers 400 naming the missing
 * one, so the form does not have to encode the same rules twice.
 *
 * @returns {Promise<object>} the created row, including its server-assigned id
 */
export const createContent = async (type, body) => (await provider()).createContent(type, writable(body));

/** Patch a row. Omitted fields are left alone; see the module docblock. */
export const updateContent = async (type, id, body) => (await provider()).updateContent(type, id, writable(body));

/** Hide a row without destroying it; resolves to the updated row. */
export const archiveContent = async (type, id) => (await provider()).archiveContent(type, id);

export const restoreContent = async (type, id) => (await provider()).restoreContent(type, id);
