/* Owner-private lead annotations (prototype, localStorage).

   The Requests inbox is a lightweight lead desk: alongside each buyer/seeker
   request an owner can jot a private note and set a follow-up date. There is no
   backend yet, so these live per-owner in localStorage — keyed by the owner's
   digits and a stable per-lead id (e.g. 'number:c1', 'documents:99…|PROP1').

   This is the local home for the CRM "notes" and "follow-up date" fields until a
   real store exists; the shapes are intentionally minimal so a future backend can
   adopt them 1:1. */

const digits = (n) => String(n || '').replace(/\D/g, '');
const storeKey = (owner) => 'puneNestLeadNotes:' + (digits(owner) || 'anon');

export function getLeadAnnotations(owner) {
  try {
    return JSON.parse(localStorage.getItem(storeKey(owner))) || {};
  } catch {
    return {};
  }
}

export function getLeadAnnotation(owner, leadId) {
  return getLeadAnnotations(owner)[leadId] || null;
}

/* Merge a patch ({ note?, followUpAt? }) into a lead's annotation. Empty
   annotations are pruned so the store never accumulates blank rows. Returns the
   updated (or null, if pruned) annotation. */
export function setLeadAnnotation(owner, leadId, patch) {
  const all = getLeadAnnotations(owner);
  const next = { ...(all[leadId] || {}), ...patch, updatedAt: Date.now() };
  if (!next.note && !next.followUpAt) delete all[leadId];
  else all[leadId] = next;
  try {
    localStorage.setItem(storeKey(owner), JSON.stringify(all));
  } catch {
    /* ignore quota / private-mode write failures */
  }
  return all[leadId] || null;
}
