import { classNames } from '../../../lib/format.js';
import { BTN } from '../../../components/admin/WorkQueue.jsx';

export const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const fmtDate = (ts) => { try { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ''; } };

/* The fourth duplicate-hint state: the check itself did not answer, which must not render "No obvious match". */
export const DUPES_FAILED = 'failed';
export const Chip = ({ tone, icon, children }) => (
  <span className={classNames('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]', tone)}>{icon}{children}</span>
);

export const PLAIN = BTN.ghost;

export const actBtn = (label, tone, onClick, disabled = false) => (
  <button type="button" onClick={onClick} disabled={disabled} className={classNames(tone, 'disabled:cursor-not-allowed disabled:opacity-40')}>{label}</button>
);
