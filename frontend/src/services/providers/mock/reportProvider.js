/**
 * Mock report provider — the localStorage counterpart to `providers/http/reportProvider.js`.
 *
 * Storage stays where it was (the mock DB's `reports` collection, via `lib/data/reports.js` and
 * `lib/mockApi/collections.js`), so the admin queue's demo data keeps working unchanged.
 *
 * ## The mock is the permissive one, in three ways that matter
 *
 * 1. **No duplicate rule.** The server refuses a second live report of the same target by the same
 *    person (409, backed by a partial unique index). Here you may file forever.
 * 2. **No role guard.** `listReports` and `triageReport` answer for anybody; live they are
 *    staff/admin and 403 otherwise.
 * 3. **No transition rule.** A decided report can be reopened; the server treats terminal as
 *    terminal.
 *
 * All three are asymmetries in the safe direction — a flow that works live also works here — and all
 * three are why the ops queue needs to handle failures it never sees on mocks.
 */
import { readUser } from '../../../lib/auth.js';
import { listReports as _list, mutateDb, rawDb } from '../../../lib/mockApi.js';
import { submitReport as _submit } from '../../../lib/data/reports.js';
import { toTargetType, reasonLabel } from '../http/reportMapper.js';

/**
 * One open report per person per target, mirrored from the server.
 *
 * The http provider turns the server's 409 into the string `'duplicate'` so the modal can say
 * "you already reported this" instead of thanking someone for a report nobody received. Without
 * this check the mock accepted every press, so the same UI took a *different* branch under the two
 * providers — and the branch that only mock mode exercised was the one that lies to the user.
 *
 * Matched on the reporter's mobile rather than their name: names are neither unique nor stable, and
 * a duplicate guard keyed on one lets a rename reopen the door.
 *
 * Scoped to `open`. A closed report is a decision that has been made; if the thing is still up and
 * still wrong, that is a new complaint and ops need to see it as one.
 */
function alreadyReported(kind, targetId, mobile) {
  const id = String(targetId || '');
  const mob = String(mobile || '').replace(/\D/g, '');
  if (!id || !mob) return false;
  return (rawDb().reports || []).some(
    (r) => r.status === 'open'
      && String(r.targetId) === id
      && (r.kind || 'listing') === kind
      && String(r.reporterMobile || '').replace(/\D/g, '') === mob,
  );
}

export async function createReport(report) {
  const u = readUser();
  const kind = report?.kind || 'listing';
  if (alreadyReported(kind, report?.targetId, u?.mobile)) return 'duplicate';
  return _submit({
    kind,
    listingId: report?.targetId,
    listingTitle: report?.targetTitle,
    ownerName: report?.targetOwner,
    ownerMobile: report?.ownerMobile,
    reason: report?.reason,
    // Resolved through the same function the http mapper uses, so both providers label a reason
    // identically — the label is presentation text the client owns on both sides. Passed the *target
    // type* and not just the code, because `spam` on a listing and `spam` from an owner are
    // different complaints with different wording.
    reasonLabel: reasonLabel(report?.reason, toTargetType(kind)),
    details: report?.details || '',
    reportedBy: u?.name || 'User',
    reporterMobile: u?.mobile || '',
    url: report?.url || '',
  });
}

export async function listReports({ status } = {}) {
  const all = await _list();
  /* Same filter the http provider sends to the server, applied here instead. Ignoring it was not a
     harmless permissiveness like the three above: a caller that wants two statuses asks twice, and
     an unfiltered answer returns the whole store both times — duplicate React keys and a moderation
     queue showing every complaint twice. Blank still means "everything", as it does live. */
  const items = status ? all.filter((r) => r.status === status) : all;
  // The mock store is unpaged; answer the paged contract by reporting the whole list as one page.
  return { items, total: items.length, page: 0, size: items.length };
}

export async function triageReport(id, decision) {
  let updated = null;
  mutateDb((db) => {
    const r = (db.reports || []).find((x) => x.id === id);
    if (!r) return;
    r.status = decision?.status;
    r.handledAt = Date.now();
    // `actionTaken` is mock-only free text; the server keeps the moderator's words in the audit
    // log instead, so this has no live counterpart. Reopening clears it, matching the old queue.
    if (decision?.status === 'open') r.actionTaken = '';
    else if (decision?.actionTaken !== undefined) r.actionTaken = decision.actionTaken;
    updated = { ...r };
  });
  return updated;
}
