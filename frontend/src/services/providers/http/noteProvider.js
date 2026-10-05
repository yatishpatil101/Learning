import { get, post } from '../../http.js';
import { toNote, toNotes, toWireType } from './noteMapper.js';

const base = (entityType, entityId) =>
  `/admin/notes/${toWireType(entityType)}/${encodeURIComponent(entityId)}`;

/** Every note on one entity, newest first — the server orders it, this does not re-sort. */
export async function listNotes(entityType, entityId) {
  return toNotes(await get(base(entityType, entityId)));
}

/** `action` is omitted rather than sent as `""` when there is none: the field is optional on the contract and an
 * empty string would render as an empty chip beside the byline. */
export async function addNote(entityType, entityId, text, action) {
  const body = { text: String(text ?? '').trim() };
  const label = String(action ?? '').trim();
  if (label) body.action = label;
  return toNote(await post(base(entityType, entityId), body));
}
