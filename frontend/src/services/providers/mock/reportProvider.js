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
import { listReports as _list, mutateDb } from '../../../lib/mockApi.js';
import { submitReport as _submit } from '../../../lib/data/reports.js';
import { REASON_LABELS } from '../http/reportMapper.js';

export async function createReport(report) {
  const u = readUser();
  const kind = report?.kind || 'listing';
  return _submit({
    kind,
    listingId: report?.targetId,
    listingTitle: report?.targetTitle,
    ownerName: report?.targetOwner,
    ownerMobile: report?.ownerMobile,
    reason: report?.reason,
    // Resolved from the same table the http mapper uses, so both providers label a reason
    // identically — the label is presentation text the client owns on both sides.
    reasonLabel: REASON_LABELS[report?.reason] || report?.reason,
    details: report?.details || '',
    reportedBy: u?.name || 'User',
    reporterMobile: u?.mobile || '',
    url: report?.url || '',
  });
}

export async function listReports() {
  // The mock store is unpaged; answer the paged contract by reporting the whole list as one page.
  const items = await _list();
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
