import { rawDb, rng, iso, daysAgo } from './internals.js';

// Visits / page views / signups for the last `days` days (default window 90).
export function trafficSeries(days) {
  const r = rng(424242);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const base = 1400 + (days - i) * 14;
    const wknd = [0, 6].indexOf(daysAgo(i).getDay()) !== -1 ? 0.8 : 1;
    out.push({
      date: iso(daysAgo(i)),
      visits: Math.round((base + r() * 600) * wknd),
      pageviews: Math.round((base * 3.4 + r() * 1800) * wknd),
      signups: Math.round((18 + r() * 26) * wknd),
    });
  }
  return out;
}

// Conversion funnel derived from the mock DB (matches admin-data.js funnel()).
export function funnel() {
  const db = rawDb();
  const views = db.listings.reduce((a, b) => a + (b.views || 0), 0);
  return [
    { k: 'Visitors', v: trafficSeries(30).reduce((a, b) => a + b.visits, 0) },
    { k: 'Listing views', v: views },
    { k: 'Enquiries', v: db.enquiries.length * 60 },
    { k: 'Site visits', v: db.visits.length * 50 },
    { k: 'Deals closed', v: db.deals.filter((d) => d.status === 'closed').length * 30 },
  ];
}

// Status label map mirrored from admin-components.js STATUS.
const STATUS_LABEL = {
  pending: 'Pending',
  approved: 'Approved',
  active: 'Active',
  rejected: 'Rejected',
  flagged: 'Flagged',
  sold: 'Closed',
  suspended: 'Suspended',
  closed: 'Closed',
};
export function statusLabel(status) {
  return STATUS_LABEL[status] || status;
}

// Listings grouped by status (matches admin-data.js dealStatus()).
export function dealStatus() {
  const db = rawDb();
  const by = {};
  db.listings.forEach((l) => {
    by[l.status] = (by[l.status] || 0) + 1;
  });
  return Object.keys(by).map((k) => ({ k, v: by[k] }));
}
