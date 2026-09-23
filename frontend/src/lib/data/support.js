import i18n from '../../i18n/index.js';

const CATEGORIES = [
  { key: 'payment', label: 'Payments & Refunds', icon: 'indian-rupee' },
  { key: 'rent', label: 'Rent Payment / HRA', icon: 'receipt-indian-rupee' },
  { key: 'listing', label: 'Property Listing', icon: 'building-2' },
  { key: 'verification', label: 'Verification / KYC', icon: 'badge-check' },
  { key: 'account', label: 'Account & Login', icon: 'user-cog' },
  { key: 'booking', label: 'Visit / Booking', icon: 'calendar-check' },
  { key: 'service', label: 'Home Services', icon: 'concierge-bell' },
  { key: 'technical', label: 'Technical / Bug', icon: 'bug' },
  { key: 'other', label: 'Something else', icon: 'help-circle' },
];

const STATUS = {
  open: { label: 'Open' },
  'in-progress': { label: 'In progress' },
  waiting: { label: 'Awaiting your reply' },
  resolved: { label: 'Resolved' },
  closed: { label: 'Closed' },
};

export function getCatLabel(k) {
  const c = CATEGORIES.find((cat) => cat.key === k);
  return i18n.t('misc.cat_' + k, { defaultValue: c ? c.label : 'Support' });
}

export function getCatIcon(k) {
  const c = CATEGORIES.find((cat) => cat.key === k);
  return c ? c.icon : 'help-circle';
}

export function getStatusLabel(k) {
  return i18n.t('misc.status_' + k, { defaultValue: STATUS[k] ? STATUS[k].label : k });
}

export function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const n = new Date();
  const diff = (n - d) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400 && d.getDate() === n.getDate())
    return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return (
    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
    ', ' +
    d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  );
}

export { CATEGORIES, STATUS };
