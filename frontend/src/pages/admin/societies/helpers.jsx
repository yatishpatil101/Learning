import { classNames } from '../../../lib/format.js';
import { openDocUrl } from '../../../lib/openDoc.js';
import { BTN } from '../../../components/admin/WorkQueue.jsx';

export const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const fmtDate = (ts) => { try { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ''; } };

export const PROOF_LABELS = { maintenance: 'Maintenance receipt', agreement: 'Agreement', utility: 'Utility bill', allotment: 'Allotment letter', other: 'Other proof' };
export const openDoc = (doc) => openDocUrl(doc && doc.dataUrl);

/* The fourth state of the duplicate hint.
   `undefined` is "still checking", `[]` is "checked, nothing resembles it", an array is the hints —
   and this is "the check itself did not answer". It exists because the other three cannot express
   it: a failed request used to record `[]`, which renders "No obvious match", which is the one
   sentence that gets a duplicate verified into a permanent second copy. The console warning behind
   it is not a signal an operator working a queue will ever see. */
export const DUPES_FAILED = 'failed';
export const Chip = ({ tone, icon, children }) => (
  <span className={classNames('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]', tone)}>{icon}{children}</span>
);

export const TEAL = BTN.primary;
export const RED = BTN.danger;
export const PLAIN = BTN.ghost;

export const actBtn = (label, tone, onClick, disabled = false) => (
  <button type="button" onClick={onClick} disabled={disabled} className={classNames(tone, 'disabled:cursor-not-allowed disabled:opacity-40')}>{label}</button>
);
