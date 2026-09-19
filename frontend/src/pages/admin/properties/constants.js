import { fmtArea, fmtINR, fmtNum, isSqftUnit } from '../../../lib/format.js';

export const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'archived', label: 'Archived' },
];
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
  { value: 'rejected', label: 'Rejected' },
  { value: 'flagged', label: 'Flagged' },
];

export const PAGE_LIMIT = 15;

/* Only the first four are a stored stage: `derived: true` marks the two the board works out from `status`,
   because storing them would write the same fact twice from two actions that can disagree. */
export const PIPELINE_STAGES = [
  { key: 'contacted', label: 'Contacted', color: 'bg-gray-500/15 text-gray-300 border-gray-500/30' },
  { key: 'info_collected', label: 'Info Collected', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  { key: 'listed', label: 'Listed', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { key: 'docs_submitted', label: 'Docs Submitted', color: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  { key: 'under_review', label: 'Under Review', color: 'bg-teal-500/15 text-teal-300 border-teal-500/30', derived: true },
  { key: 'live', label: 'Live', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', derived: true },
];

/* The owner's half of the funnel: a separate axis from the stages above, because a listing has a
   place on the acquisition funnel and a hand-back milestone at the same time. */
export const HANDBACK_MILESTONES = [
  { key: 'photos_uploaded', label: 'Photos uploaded' },
  { key: 'identity_verified', label: 'Identity verified' },
  { key: 'claim_sent', label: 'Claim sent' },
  { key: 'claimed', label: 'Claimed' },
];

export const KPI_TINTS = {
  indigo: 'bg-indigo-500/15 text-indigo-300',
  emerald: 'bg-emerald-500/15 text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-300',
  rose: 'bg-rose-500/15 text-rose-300',
  teal: 'bg-teal-500/15 text-teal-300',
};

export const dealLabel = (d) => (d === 'rent' ? 'For Rent' : 'For Sale');
export const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);
export const perSqftLabel = (l) =>
  // A plot priced by the acre divided by its acreage is a per-acre figure, so the row that captions
  // it "/ sq.ft" has nothing honest to say about one.
  l.area && l.deal !== 'rent' && isSqftUnit(l.areaUnit)
    ? fmtINR(Math.round(l.price / l.area)) + ' / sq.ft'
    : l.deal === 'rent'
    ? 'Monthly rent'
    : '\u2014';
export const liveHref = (l) => `/property/${l.realId || l.id}`;

/* Re-exported so the admin property modules keep importing it from here: AdminPropertyCard is a component
   and has no business reaching into a page's constants module. */
export { fmtAgo } from '../../../lib/format.js';

export { exportCsv } from '../../../lib/csv.js';

/* A row is worth showing only when the owner stated it: a grid of em-dashes hides the handful of facts
   that decide the case. `0` and `false` are statements and survive; blank and null do not. */
const stated = (v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);

export function detailKvs(l) {
  const isLive = l.status === 'approved';
  const kvs = [
    ['Listing ID', l.id],
    ['Status', cap(l.status)],
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
