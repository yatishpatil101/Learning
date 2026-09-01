/**
 * Mock lead-note provider — the localStorage counterpart to `providers/http/leadNoteProvider.js`.
 *
 * Wraps `lib/leadNotes.js` unchanged, so annotations written by existing e2e specs under
 * `puneNestLeadNotes:<ownerDigits>` still read back. The only work here is shape: the store keeps a
 * `{ [leadKey]: annotation }` map, while the seam contract is an array of rows carrying their own
 * `leadKey` — because that is what an unpaged collection endpoint returns, and a call site must not
 * be able to tell which provider it is talking to.
 *
 * ## Timestamps stay as they are
 *
 * The store writes `updatedAt` as epoch millis; the server sends an ISO string. Neither is converted
 * in either provider — both of the panel's consumers accept either, and normalising in one provider
 * only would make the mock the odd one out, which is the failure mode this file exists to prevent.
 *
 * ## The bug this mock reproduces, and why that is deliberate
 *
 * The store is keyed by `myMobile()`, so an owner's notes live in whichever browser they were typed
 * in. Answering enquiries on a phone and a laptop yields two disjoint sets, neither of them wrong.
 * That is the defect the live domain exists to fix, and it is preserved here rather than quietly
 * corrected: a mock that works better than the thing it stands in for hides the reason for the
 * migration.
 */
import { myMobile } from '../../../lib/contact.js';
import { getLeadAnnotations, setLeadAnnotation } from '../../../lib/leadNotes.js';

/** Caller-scoped, like the live store — never an owner named by the call site. */
const me = () => myMobile();

/** The stored map turned into the wire's array-of-rows, each carrying the key it was filed under. */
const toRows = (map) => Object.entries(map || {}).map(([leadKey, a]) => ({
  leadKey,
  note: a?.note ?? null,
  followUpAt: a?.followUpAt ?? null,
  updatedAt: a?.updatedAt ?? null,
}));

export async function myLeadNotes() {
  return toRows(getLeadAnnotations(me()));
}

/**
 * Upsert one annotation, or clear it.
 *
 * Takes the whole annotation rather than a patch, matching the live contract. `setLeadAnnotation`
 * merges internally and prunes a row with neither field, so passing the complete object through is
 * enough to make clearing work — and `null` comes back for a pruned row, which is the mock's
 * equivalent of the server's `204`.
 */
export async function saveLeadNote(leadKey, { note = null, followUpAt = null } = {}) {
  const saved = setLeadAnnotation(me(), leadKey, { note, followUpAt });
  return saved ? { leadKey, note: saved.note ?? null, followUpAt: saved.followUpAt ?? null, updatedAt: saved.updatedAt ?? null } : null;
}
