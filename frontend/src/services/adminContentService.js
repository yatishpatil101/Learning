/**
 * Admin Content Service - the CMS authoring side of the four managed content lists.
 *
 * Five operations against `/admin/content/{type}`: list, create, update, archive, restore. The
 * `{type}` is one of `announcements`, `services`, `faqs`, `banners`, and it is the discriminator
 * for the whole shape - a caller of `list('faqs')` knows it is getting FAQ rows before the response
 * arrives, which is why there is one flat `ContentItem` rather than four schemas.
 *
 * ## Why this is separate from `contentService`
 *
 * `contentService` is the public read: what a signed-out visitor is allowed to see. This is the
 * authoring surface, and the difference is not merely one of permission. The public reads never
 * return archived rows and must not say whether one exists; this one has an Archived tab as a
 * first-class feature. Folding them together would mean one module whose return shape depended on
 * who was asking, which is the kind of thing that is fine until the day it is not.
 *
 * ## The mock and the server disagree, and the server wins
 *
 * The browser-side CMS grew field names the API has no column for, and this seam is where that ends
 * rather than where it is papered over:
 *
 * - **banners** were `{ title, sub, cta, href, theme, active }`; the server stores
 *   `{ headline, image, link, position }`. There is no CTA label, no theme and no active flag.
 * - **faqs** were `{ q, a, cat, active }`; the server stores `{ question, answer, category }`.
 *   Abbreviations are not a wire format, and withdrawal is `archive`, not `active: false`.
 * - **announcements** were `{ title, body, audience, active }`; the server stores
 *   `{ title, body, severity, startsAt, endsAt, active }`. There is no audience column; there is a
 *   schedule, which is the more useful half of what `audience` was being asked to imply.
 *
 * The dropped fields were only ever rendered by the admin editor that wrote them - no consumer
 * surface read a mock banner or announcement - so nothing published to a visitor changes.
 *
 * ## PATCH is merge, POST is not
 *
 * `update` sends only the fields the form changed, and the server treats `null` as "leave alone".
 * That is deliberate on both sides: the editor renders the fields for one type at a time, so
 * replace semantics would blank whatever the open form did not happen to show. The one exception
 * is `translations`, which is replaced whole - a merge would leave a deleted translation
 * undeletable.
 */
import { createProvider } from './config.js';

const provider = createProvider('adminContent');

/** The four types the API manages. Anything else is a 400 from the server, not a silent empty list. */
export const CONTENT_TYPES = ['announcements', 'services', 'faqs', 'banners'];

/**
 * Fields the server owns, stripped out of every write body.
 *
 * The console's edit modal is seeded with the whole row (`{ ...item }`) because that is what makes
 * the form show what is currently stored. Posting the whole row back would hand the server four
 * fields it does not accept on `ContentWrite` — and `archived` in particular would be a second,
 * unaudited way to archive a row, competing with the endpoint that exists to do exactly that.
 *
 * Filtered here rather than in the page, because the rule is about the API's write contract and not
 * about one form; and here rather than in the providers, because both transports have to obey it.
 */
const SERVER_OWNED = ['id', 'type', 'archived', 'createdAt'];

/** A write body with the server-owned fields removed. */
const writable = (body) => {
  const out = { ...(body || {}) };
  SERVER_OWNED.forEach((k) => { delete out[k]; });
  return out;
};

/**
 * Every row of one type, archived ones included.
 *
 * Archived rows arrive mixed in with the rest and are told apart by `archived`, rather than being
 * fetched separately. The console shows both at once, and two requests would let the two halves
 * disagree about the same row mid-edit.
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

/** Hide a row without destroying it. Returns the updated row so the caller need not guess. */
export const archiveContent = async (type, id) => (await provider()).archiveContent(type, id);

/** Un-hide an archived row. */
export const restoreContent = async (type, id) => (await provider()).restoreContent(type, id);
