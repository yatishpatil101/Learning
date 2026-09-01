/**
 * Mock note provider — internal notes over the browser store (D29).
 *
 * This is what the four moderation handlers used to call directly, now behind the seam. The
 * difference is not the storage: it is that a component no longer decides where a note lives.
 *
 * Two rules from the server are enforced here rather than left to the mock's older, looser store,
 * so a call site that breaks them fails in the mock suite instead of only against a live backend:
 *
 * - **the entity kind is a closed set.** `toWireType` throws on anything else. A typo that fell
 *   through would read as "no notes on this case", which is exactly what a clean case looks like.
 * - **blank text is refused.** The old store wrote a row when it had an action label and nothing to
 *   say, drawing an empty bullet under a colleague's name.
 *
 * `listing` is bridged to `property` here too. The mock keys its buckets by whatever it is handed,
 * so without the bridge a note written in mock mode and one written live would file under different
 * words, and the mock suite would stop testing the live key.
 */
import {
  addInternalNote,
  editInternalNote,
  getInternalNotes,
} from '../../../lib/mockApi/audit.js';
import { delay } from '../../../lib/mockApi/core.js';
import { toWireType } from '../http/noteMapper.js';

/** Store row → the view model `noteService` promises. */
function toNote(row, entityType, entityId) {
  return {
    id: String(row?.id || ''),
    entityType: entityType || '',
    entityId: String(entityId || ''),
    author: row?.by || '',
    action: row?.action || '',
    text: row?.text || '',
    at: row?.at || null,
    editedAt: row?.editedAt || null,
  };
}

export function listNotes(entityType, entityId) {
  const kind = toWireType(entityType);
  return delay(getInternalNotes(kind, entityId).map((row) => toNote(row, kind, entityId)));
}

export function addNote(entityType, entityId, text, action) {
  const kind = toWireType(entityType);
  const row = addInternalNote(kind, entityId, text, action);
  if (!row) return Promise.reject(new Error('A note needs something written in it.'));
  return delay(toNote(row, kind, entityId));
}

export function editNote(id, text) {
  const row = editInternalNote(id, text);
  if (!row) return Promise.reject(new Error('That note no longer exists.'));
  return delay(toNote(row, row.entityType, row.entityId));
}
