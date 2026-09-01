/**
 * HTTP note provider (D29).
 *
 * Three calls onto `/admin/notes`, which is a back-office route family rather than four routes hung
 * off `/properties`, `/users`, `/reviews` and `/reports`: the notes are one table with one guard and
 * one audience, and four route families would have been four copies of the same three handlers.
 *
 * The list route answers with a **bare array**, not a page envelope. A case with more than a page of
 * notes on it is a case somebody should be reading in full, and a paged reader that stopped at
 * twenty would hide the oldest — which is usually the one explaining how the case started.
 *
 * `listing → property` is bridged in `noteMapper.js`; nothing in this file knows about either word.
 */
import { get, patch, post } from '../../http.js';
import { toNote, toNotes, toWireType } from './noteMapper.js';

const base = (entityType, entityId) =>
  `/admin/notes/${toWireType(entityType)}/${encodeURIComponent(entityId)}`;

/** Every note on one entity, newest first — the server orders it, this does not re-sort. */
export async function listNotes(entityType, entityId) {
  return toNotes(await get(base(entityType, entityId)));
}

/**
 * Add a note.
 *
 * `action` is omitted rather than sent as `""` when there is none: the field is optional on the
 * contract and an empty string would render as an empty chip beside the byline.
 */
export async function addNote(entityType, entityId, text, action) {
  const body = { text: String(text ?? '').trim() };
  const label = String(action ?? '').trim();
  if (label) body.action = label;
  return toNote(await post(base(entityType, entityId), body));
}

/** Correct an existing note's wording. The byline and the action label do not move. */
export async function editNote(id, text) {
  return toNote(await patch(`/admin/notes/${encodeURIComponent(id)}`, {
    text: String(text ?? '').trim(),
  }));
}
