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
/* Team-internal notes attached to any entity (listing, user, review, report, etc.).
   Stored in db.internalNotes keyed by "entityType:entityId". Each note is timestamped
   with the author and action context. These are never deleted — full audit trail. */

export function addInternalNote(entityType, entityId, text, action) {
  const clean = String(text || '').trim();
  const cleanAction = String(action || '').trim();
  // Save when there's text OR an action label — always record the action context
  if (!clean && !cleanAction) return null;
  const key = `${entityType}:${entityId}`;
  return mutateDb((db) => {
    if (!db.internalNotes) db.internalNotes = {};
    if (!db.internalNotes[key]) db.internalNotes[key] = [];
    const note = {
      id: 'IN' + Date.now() + Math.floor(Math.random() * 1000),
      at: new Date().toISOString(),
      by: currentAdminName(),
      action: action || '',
      text: clean,
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
