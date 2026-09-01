// ---------------- Audit log ----------------
/* Port of admin-data.js logAudit/auditLog/clearAudit. Records admin actions to a
   capped (200) list in the mock DB. `who` is the current signed-in admin's name.
   These are synchronous (no delay) so callers can fire-and-forget after a mutation. */
import { rawLoad, rawSave, mutateDb, currentStaffInfo } from './core.js';

function currentAdminName() {
  return currentStaffInfo().name;
}

export function logAudit(action, detail) {
  const db = rawLoad();
  if (!Array.isArray(db.auditLog)) db.auditLog = [];
  db.auditLog.unshift({
    id: 'AL' + Date.now() + Math.floor(Math.random() * 1000),
    at: new Date().toISOString(),
    who: currentAdminName(),
    action: String(action || ''),
    detail: String(detail || ''),
  });
  if (db.auditLog.length > 200) db.auditLog = db.auditLog.slice(0, 200);
  rawSave(db);
  return db.auditLog;
}

export function listAudit() {
  const db = rawLoad();
  return Array.isArray(db.auditLog) ? db.auditLog : [];
}

export function clearAudit() {
  const db = rawLoad();
  db.auditLog = [];
  rawSave(db);
}

// ---------------- Internal Notes ----------------
/* Team-internal notes attached to a listing, user, review or report (D29).

   These are no longer the feature. `services/noteService.js` is, and in live mode the notes are
   rows in `internal_notes` that every member of staff can read. What is left here is the mock half
   of that seam — reached only through `services/providers/mock/noteProvider.js`, which is why the
   two readers below are not exported from anywhere a component can see.

   Stored in db.internalNotes keyed by "entityType:entityId", newest first. Kept deliberately in
   step with the server's rules so a bug shows up in the mock suite rather than only in live:
   text is required, the action label is written once and never edited, and there is no delete. */

/**
 * Add a note. Refuses a blank one — the old version saved a row when there was an action label and
 * no text, which drew an empty bullet under somebody's name.
 *
 * @returns {object|null} the stored note, or null when there was nothing to store
 */
export function addInternalNote(entityType, entityId, text, action) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const key = `${entityType}:${entityId}`;
  return mutateDb((db) => {
    if (!db.internalNotes) db.internalNotes = {};
    if (!db.internalNotes[key]) db.internalNotes[key] = [];
    const note = {
      id: 'IN' + Date.now() + Math.floor(Math.random() * 1000),
      at: new Date().toISOString(),
      by: currentAdminName(),
      action: String(action || '').trim(),
      text: clean,
      editedAt: null,
    };
    db.internalNotes[key].unshift(note);
    return note;
  });
}

export function getInternalNotes(entityType, entityId) {
  const db = rawLoad();
  const key = `${entityType}:${entityId}`;
  return (db.internalNotes && db.internalNotes[key]) || [];
}

/**
 * Correct an existing note's wording, wherever it is filed.
 *
 * The id is the only handle a caller has — the widget that offers the correction is already looking
 * at the note and has no reason to also know which bucket it came out of — so this scans the
 * buckets. That is fine at mock scale and is not how the server does it, which keys the row
 * directly.
 *
 * Anyone may correct anyone's note, and the byline does not change hands: the note records what the
 * team knows, not who last touched the keyboard.
 *
 * @returns {object|null} the corrected note with the bucket it lives in spliced back on, or null
 *   when no note has this id
 */
export function editInternalNote(id, text) {
  const clean = String(text || '').trim();
  if (!id || !clean) return null;
  return mutateDb((db) => {
    const buckets = db.internalNotes || {};
    for (const key of Object.keys(buckets)) {
      const note = (buckets[key] || []).find((n) => n.id === id);
      if (!note) continue;
      note.text = clean;
      note.editedAt = new Date().toISOString();
      const split = key.indexOf(':');
      return { ...note, entityType: key.slice(0, split), entityId: key.slice(split + 1) };
    }
    return null;
  });
}

