/* Reports data layer — handles property listing reports (reason + details) persisted to the
   mock DB's reports collection. The admin moderation queue is in src/pages/admin/Reports.jsx
   which reads from the same collection. */
import { mutateDb } from '../mockApi.js';

// HTML property.html report reasons (exact parity)
export const REPORT_REASONS = [
  ['sold', 'Already sold or rented out'],
  ['fake', 'Fake photos or misleading info'],
  ['unavailable', 'Owner not responding / unreachable'],
  ['pricing', 'Overpriced / incorrect price'],
  ['spam', 'Spam or duplicate listing'],
  ['broker', 'Posted by a broker / not the owner'],
  ['other', 'Something else'],
];

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
      reportedBy: reportedBy || 'Anonymous',
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
