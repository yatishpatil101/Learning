import { classNames } from '../../../lib/format.js';
import { openDocUrl } from '../../../lib/openDoc.js';

export const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const fmtDate = (ts) => { try { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ''; } };

export const PROOF_LABELS = { maintenance: 'Maintenance receipt', agreement: 'Agreement', utility: 'Utility bill', allotment: 'Allotment letter', other: 'Other proof' };
export const REPORT_LABELS = { contribution: 'Community post', reply: 'Reply', review: 'Review', question: 'Question', answer: 'Answer', board: 'Event / notice' };
export const openDoc = (doc) => openDocUrl(doc && doc.dataUrl);
export const Chip = ({ tone, icon, children }) => (
  <span className={classNames('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]', tone)}>{icon}{children}</span>
);

export const TEAL = 'border-brand-teal/30 bg-brand-teal/10 text-brand-teal';
export const RED = 'border-red-400/30 bg-red-500/10 text-red-300';
export const PLAIN = 'border-white/10 bg-white/5 text-gray-200';

export const actBtn = (label, tone, onClick, disabled = false) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={classNames('rounded-lg border px-2 py-1 text-xs', tone, disabled && 'cursor-not-allowed opacity-40')}
  >{label}</button>
);
