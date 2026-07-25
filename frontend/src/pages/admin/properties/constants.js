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

export const PIPELINE_STAGES = [
  { key: 'contacted', label: 'Contacted', color: 'bg-gray-500/15 text-gray-300 border-gray-500/30' },
  { key: 'info_collected', label: 'Info Collected', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  { key: 'listed', label: 'Listed', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { key: 'docs_submitted', label: 'Docs Submitted', color: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  { key: 'under_review', label: 'Under Review', color: 'bg-teal-500/15 text-teal-300 border-teal-500/30' },
  { key: 'live', label: 'Live', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
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

export function fmtAgo(ts) {
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  return new Date(t).toLocaleDateString('en-IN');
}

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
