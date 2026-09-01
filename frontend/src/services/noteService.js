/**
 * Note Service — the internal notes staff keep on a case (D29).
 *
 * ## What this replaces
 *
 * Four moderation handlers used to call `addInternalNote(...)` from `lib/mockApi/audit.js` in the
 * same breath as a real API call: approve a listing and the decision went to the server while the
 * reasoning went to `db.internalNotes` in this browser's localStorage. The colleague who opened the
 * same listing the next morning saw the outcome and no explanation, and nothing about the screen
 * said anything was missing — a note that was never stored and a case nobody annotated render
 * identically. The read side was worse than useless: `lib/mockApi/users.js` returned `[]` for every
 * person, because nothing had ever written a `user:` key.
 *
 * ## `property`, not `listing`
 *
 * Every call site in this app says `listing`. The contract says `property`, as it does everywhere
 * else — `/properties`, `ReportTargetTypes.PROPERTY`, `PropertyResponse`. Rather than rename forty
 * call sites or bend the API to one client's vocabulary, the http provider's mapper bridges the two
 * words once, in one place. Callers keep saying `listing`; the wire keeps saying `property`. The
 * mock provider does the same so both halves of the seam accept the same argument.
 *
 * ## Notes are retained customer information, not scratch
 *
 * That decision (2026-08-17) is what makes this domain look unlike the audit log next to it:
 *
 * - **Mutable.** `editNote` exists. A note that recorded the wrong flat number should be corrected,
 *   not contradicted three notes later. The previous wording survives in the audit log, so mutable
 *   does not mean quietly rewritable.
 * - **No per-team walls.** Any staff or admin reads any note. Deliberately inter-transparent: a
 *   note the next shift cannot see is a note that did not need writing.
 * - **No delete.** There is no `deleteNote` here because there is no DELETE route. Retained
 *   information is retained.
 *
 * ## Not the timeline
 *
 * `GET /users/{id}/timeline` is admin-only and its `kind` enum has no `note`. Notes on a person go
 * through this domain instead, which staff can reach — the audience that writes them is the
 * audience that must be able to read them back.
 */
import { createProvider } from './config.js';

const provider = createProvider('note');

/**
 * Every note on one entity, newest first.
 *
 * @param {'listing'|'user'|'review'|'report'} entityType which kind of record. `listing` is bridged
 *   to the contract's `property` inside the provider.
 * @param {string} entityId the record's id
 * @returns {Promise<Array<{id: string, author: string, action: string, text: string, at: string,
 *   editedAt: string|null}>>} `author` is a display name where the account is still resolvable and
 *   the raw author id otherwise — an id is uglier than a name and far better than an empty byline.
 * @throws {ApiError} 403 when the caller is not staff or admin.
 */
export const listNotes = async (entityType, entityId) =>
  (await provider()).listNotes(entityType, entityId);

/**
 * Add a note. The author is taken from the caller's token, never from here.
 *
 * @param {'listing'|'user'|'review'|'report'} entityType
 * @param {string} entityId
 * @param {string} text required and non-blank — the old store saved a note with an action label and
 *   no text, which rendered as an empty bullet under somebody's name
 * @param {string} [action] the decision this note was filed beside, e.g. `Approved`. Recorded once
 *   and not editable afterwards: it describes what happened, not what somebody thinks about it.
 * @returns {Promise<object>} the stored note, in the same shape `listNotes` returns
 */
export const addNote = async (entityType, entityId, text, action) =>
  (await provider()).addNote(entityType, entityId, text, action);

/**
 * Correct the wording of an existing note. Any staff member may correct any note, and the byline
 * does not change hands when they do.
 *
 * @param {string} id the note's id
 * @param {string} text the replacement wording
 * @returns {Promise<object>} the corrected note
 * @throws {ApiError} 404 when no note has this id
 */
export const editNote = async (id, text) => (await provider()).editNote(id, text);
