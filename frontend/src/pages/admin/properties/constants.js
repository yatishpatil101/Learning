import { fmtArea, fmtINR, fmtNum, isSqftUnit } from '../../../lib/format.js';

// The four pending buckets the server partitions by `progress`; their labels match the tracker's.
export const PROGRESS_OPTS = [
  { value: 'awaiting_confirmation', label: 'Awaiting owner confirmation' },
  { value: 'ready', label: 'Ready for review' },
  { value: 'in_review', label: 'In review' },
  { value: 'needs_info', label: 'Waiting on owner' },
];
const PROGRESS = new Set(PROGRESS_OPTS.map((o) => o.value));

export const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  ...PROGRESS_OPTS,
  { value: 'approved', label: 'Live' },
  { value: 'paused', label: 'Paused' },
  { value: 'sold', label: 'Sold' },
  { value: 'rented', label: 'Rented' },
  { value: 'rejected', label: 'Not approved' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'archived', label: 'Archived' },
];

// Archived is its own axis, not a status: unset, a moderation read mixes soft-deleted rows in.
export const statusQuery = (value) => (value === 'archived'
  ? { archived: true }
  : PROGRESS.has(value)
    ? { archived: false, progress: value }
    : { archived: false, status: value || undefined });
export const DEAL_OPTS = [
  { value: '', label: 'Buy & Rent' },
  { value: 'buy', label: 'Buy' },
  { value: 'rent', label: 'Rent' },
];
export const EDIT_DEAL_OPTS = [
  { value: 'buy', label: 'Buy' },
  { value: 'rent', label: 'Rent' },
];
export const EDIT_STATUS_OPTS = [
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
];

export const PAGE_LIMIT = 10;

export const dealLabel = (d) => (d === 'rent' ? 'For Rent' : 'For Sale');
export const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);
export const statusLabel = (status) => ({
  pending: 'Pending',
  needs_info: 'Needs info',
  approved: 'Approved',
  rejected: 'Not approved',
}[status] || cap(String(status || '').replace(/[_-]/g, ' ')));
export const perSqftLabel = (l) =>
  // A plot priced by the acre divided by its acreage is a per-acre figure, so the row that captions
  // it "/ sq.ft" has nothing honest to say about one.
  l.area && l.deal !== 'rent' && isSqftUnit(l.areaUnit)
    ? fmtINR(Math.round(l.price / l.area)) + ' / sq.ft'
    : l.deal === 'rent'
    ? 'Monthly rent'
    : '\u2014';
export const liveHref = (l) => `/property/${l.realId || l.id}`;

export { fmtAgo } from '../../../lib/format.js';

export { exportCsv } from '../../../lib/csv.js';

/* A row is worth showing only when the owner stated it: a grid of em-dashes hides the handful of facts
   that decide the case. `0` and `false` are statements and survive; blank and null do not. */
const stated = (v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);

export function detailKvs(l) {
  const isLive = l.status === 'approved';
  const kvs = [
    ['Listing ID', l.id],
    ['Status', statusLabel(l.status)],
    ['Property type', l.type],
    ['Configuration', l.bhk || '\u2014'],
    ['Deal', dealLabel(l.deal)],
    ['Locality', l.locality],
    ['Price', fmtINR(l.price)],
    ['Rate', perSqftLabel(l)],
  ];
  const push = (label, value, full) => {
    if (stated(value)) kvs.push([label, value, full]);
  };
  const sqft = (v) => fmtNum(v) + ' sq.ft';

  /* Three areas, three claims. The old single "Built-up area" row was labelled for one of them and
     fed by the generic `area`, which is exactly the mislabelling a reviewer cannot catch. */
  push('Carpet area', stated(l.carpetArea) ? sqft(l.carpetArea) : null);
  push('Built-up area', stated(l.builtUpArea) ? sqft(l.builtUpArea) : null);
  push('Super built-up area', stated(l.superBuiltUpArea) ? sqft(l.superBuiltUpArea) : null);
  if (!stated(l.carpetArea) && !stated(l.builtUpArea) && !stated(l.superBuiltUpArea)) {
    // The unqualified headline area, unlike the three above it, is whatever unit the owner chose.
    push('Area', stated(l.area) ? `${fmtArea(l.area, l.areaUnit)} (unqualified)` : null);
  }

  push('Deposit', stated(l.deposit) ? fmtINR(l.deposit) : null);
  push('Maintenance', stated(l.maintenance) ? fmtINR(l.maintenance) : null);
  if (l.negotiable !== null && l.negotiable !== undefined) kvs.push(['Negotiable', l.negotiable ? 'Yes' : 'No']);

  push('Floor', stated(l.floor) ? `${l.floor}${stated(l.totalFloors) ? ` of ${l.totalFloors}` : ''}` : null);
  push('Bathrooms', stated(l.bath) ? fmtNum(l.bath) : null);
  push('Balconies', stated(l.balconies) ? fmtNum(l.balconies) : null);
  push('Parking', stated(l.parkingSpaces) ? fmtNum(l.parkingSpaces) : null);
  push('Facing', l.facing);
  push('Overlooking', l.overlooking);
  push('Age', stated(l.ageYears) ? `${l.ageYears} yr` : null);
  push('Furnishing', cap(l.furnishing));
  push('Amenities', Array.isArray(l.amenities) ? l.amenities.join(', ') : l.amenities, true);

  push('RERA ID', l.reraId || l.rera);
  push('Ownership', cap(l.ownership));

  push('Preferred tenants', Array.isArray(l.tenants) ? l.tenants.join(', ') : l.tenants);
  if (l.pets !== null && l.pets !== undefined) kvs.push(['Pets', l.pets ? 'Allowed' : 'Not allowed']);
  push('Available from', l.availableFrom);
  push('Agreement duration', l.agreementDuration);

  if (isLive) {
    kvs.push(['Featured', l.featured ? 'Yes \u2605' : 'No']);
    kvs.push(['Views', fmtNum(l.views)]);
    kvs.push(['Enquiries', fmtNum(l.enquiries)]);
  }
  kvs.push(['Owner', l.owner]);
  kvs.push(['Owner mobile', l.ownerMobile || '\u2014']);
  kvs.push(['Submitted', l.createdAt]);
  kvs.push(['Documents on file', fmtNum(l.docsCount)]);
  push('Quality score', stated(l.qualityScore) ? `${l.qualityScore}/100` : null);
  if (l.flagReason) kvs.push(['Flag reason', l.flagReason, true]);
  return kvs;
}
