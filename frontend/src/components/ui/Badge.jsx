/**
 * Status badge pill with automatic color mapping.
 * @param {object} props
 * @param {string} props.status - Status key (approved, pending, rejected, etc.).
 * @param {React.ReactNode} [props.children] - Override display text (defaults to status label).
 * @param {string} [props.className] - Additional classes.
 */
import { classNames } from '../../lib/format.js';

const MAP = {
  approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  published: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  done: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  closed: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  rewarded: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  qualified: 'bg-teal-500/15 text-teal-300 border-teal-400/30',
  low: 'bg-teal-500/15 text-teal-300 border-teal-400/30',
  pending: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  'under review': 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  new: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
  in_progress: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/30',
  scheduled: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/30',
  responded: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/30',
  flagged: 'bg-orange-500/15 text-orange-300 border-orange-400/30',
  open: 'bg-orange-500/15 text-orange-300 border-orange-400/30',
  actioned: 'bg-red-500/15 text-red-300 border-red-400/30',
  resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  high: 'bg-red-500/15 text-red-300 border-red-400/30',
  rejected: 'bg-red-500/15 text-red-300 border-red-400/30',
  suspended: 'bg-red-500/15 text-red-300 border-red-400/30',
  cancelled: 'bg-red-500/15 text-red-300 border-red-400/30',
  dismissed: 'bg-gray-500/15 text-gray-300 border-gray-400/30',
  archived: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  muted: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  refunded: 'bg-rose-500/15 text-rose-300 border-rose-400/30',
  failed: 'bg-red-500/15 text-red-300 border-red-400/30',
};

// Display labels — user-facing text for internal status codes
const LABELS = {
  pending: 'Under Review',
  'under review': 'Under Review',
  in_progress: 'In Progress',
};

export default function Badge({ status, children, className }) {
  const key = String(status || '').toLowerCase();
  const tone = MAP[key] || 'bg-white/5 text-gray-300 border-white/10';
  const label = children ?? LABELS[key] ?? String(status || '').replace('_', ' ');
  return (
    <span className={classNames('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize', tone, className)}>
      {label}
    </span>
  );
}
