/* Reports data layer — handles property listing reports (reason + details) persisted to the
   mock DB's reports collection. The admin moderation queue is in src/pages/admin/Reports.jsx
   which reads from the same collection. */
import { mutateDb } from '../mockApi.js';

export function submitReport({ listingId, listingTitle, ownerName, ownerMobile, reason, reasonLabel, details, reportedBy, reporterMobile, url, kind }) {
  return mutateDb((db) => {
    if (!db.reports) db.reports = [];
    const rec = {
      id: 'REP' + Date.now(),
      kind: kind || 'listing',
      targetId: listingId || '',
      targetTitle: listingTitle || '',
      targetOwner: ownerName || 'Owner',
      ownerMobile: String(ownerMobile || '').replace(/\D/g, ''),
      reason,
      reasonLabel,
      details: String(details || '').trim(),
      /* Empty, not 'Anonymous'. Writing a placeholder into the record makes it *truthy*, so the
         queue's own fallback can never fire and the stored data quietly outranks the display
         decision. Whether a withheld reporter reads as "Withheld" belongs to the render layer,
         which is where the live provider already leaves it. */
      reportedBy: reportedBy || '',
      reporterMobile: String(reporterMobile || '').replace(/\D/g, ''),
      url: url || '',
      at: Date.now(),
      status: 'open',
      actionTaken: '',
      handledAt: 0,
    };
    db.reports.unshift(rec);
    return rec;
  });
}
