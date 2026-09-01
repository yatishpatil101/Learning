import { fmtINR, fmtNum } from '../../../lib/format.js';

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

/**
 * The six columns of the concierge board — but only the first four are a *stored* stage (D27).
 *
 * These six shipped as one enum, and the register carried them as one field, and that was the bug:
 * `under_review` and `live` are not places the desk moves a listing to, they are `status` read
 * sideways. A listing is under review exactly when it is `pending` and live exactly when it is
 * `approved`, so storing them as well meant the same fact was written twice by two different
 * actions that could disagree — approving a listing set `status`, and "move it to Live" set the
 * stage, and nothing made them agree. V92 kept the four the desk actually works and dropped the
 * other two from the column; `derived` marks the two the board works out for itself.
 *
 * The four settable values are also exactly what `POST /properties/{id}/pipeline` accepts on the
 * acquisition axis. Sending `under_review` or `live` is a 400 — deliberately, so this cannot quietly
 * regrow.
 */
export const PIPELINE_STAGES = [
  { key: 'contacted', label: 'Contacted', color: 'bg-gray-500/15 text-gray-300 border-gray-500/30' },
  { key: 'info_collected', label: 'Info Collected', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  { key: 'listed', label: 'Listed', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { key: 'docs_submitted', label: 'Docs Submitted', color: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  { key: 'under_review', label: 'Under Review', color: 'bg-teal-500/15 text-teal-300 border-teal-500/30', derived: true },
  { key: 'live', label: 'Live', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', derived: true },
];

/**
 * The owner's half of the funnel — the second axis V92 split out of `pipeline_stage`.
 *
 * The desk hands a staff-posted listing back to its owner, and these four record how far that got.
 * They lived in the same column as the four above until a listing that reached `claim_sent` and was
 * then moved back to `listed` lost the fact that a claim link had ever been sent. They are shown on
 * the card rather than given columns of their own: a listing has a place on the acquisition funnel
 * *and* a hand-back milestone at the same time, which is precisely what one column could not say.
 */
export const HANDBACK_MILESTONES = [
  { key: 'photos_uploaded', label: 'Photos uploaded' },
  { key: 'aadhaar_verified', label: 'Aadhaar verified' },
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
  l.area && l.deal !== 'rent'
    ? fmtINR(Math.round(l.price / l.area)) + ' / sq.ft'
    : l.deal === 'rent'
    ? 'Monthly rent'
    : '\u2014';
export const liveHref = (l) => `/property/${l.realId || l.id}`;

/* Re-exported so the admin property modules keep importing it from here, but it now lives in
   lib/format.js — AdminPropertyCard needs it for the re-check queue age and is a component, which
   has no business reaching into a page's constants module. */
export { fmtAgo } from '../../../lib/format.js';

export { exportCsv } from '../../../lib/csv.js';

export function detailKvs(l) {
  const isLive = l.status === 'approved';
  const kvs = [
    ['Listing ID', l.id],
    ['Status', cap(l.status)],
    ['Property type', l.type],
    ['Configuration', l.bhk || '\u2014'],
    ['Deal', dealLabel(l.deal)],
    ['Locality', l.locality],
    ['Built-up area', (l.area || '\u2014') + ' sq.ft'],
    ['Price', fmtINR(l.price)],
    ['Rate', perSqftLabel(l)],
  ];
  if (isLive) {
    kvs.push(['Featured', l.featured ? 'Yes \u2605' : 'No']);
    kvs.push(['Views', fmtNum(l.views)]);
    kvs.push(['Enquiries', fmtNum(l.enquiries)]);
  }
  kvs.push(['Owner', l.owner]);
  kvs.push(['Owner mobile', l.ownerMobile || '\u2014']);
  kvs.push(['Submitted', l.createdAt]);
  kvs.push(['Documents on file', fmtNum(l.docsCount)]);
  kvs.push(['Source', l.real ? 'Live user post' : 'Demo seed']);
  if (l.flagReason) kvs.push(['Flag reason', l.flagReason, true]);
  return kvs;
}
