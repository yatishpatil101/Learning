/* ---------- small UI atoms ---------- */

// Enter/Space should activate a div-based control just like a native button, so
// keyboard users get the same behaviour as a click (and Space never scrolls the
// page). Shared by the pill and toggle atoms below.
const onActivateKey = (fn) => (e) => {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    fn?.(e);
  }
};

export const Pill = ({ selected, onClick, children, className = '', dataErr, ariaLabel }) => (
  <div
    onClick={onClick}
    onKeyDown={onActivateKey(onClick)}
    role="button"
    tabIndex={0}
    aria-pressed={!!selected}
    aria-label={ariaLabel}
    data-err={dataErr}
    className={`radio-pill rounded-xl text-sm font-medium cursor-pointer ${selected ? 'selected' : 'text-gray-400'} ${className}`}
  >
    {children}
  </div>
);

/* Inline required-field error — re-exported from the shared UI component so the
   whole app (list-property + every other form) uses one implementation. */
export { default as FieldError } from '../../../components/ui/FieldError.jsx';

export const Toggle = ({ on, onClick, ariaLabel }) => (
  <div
    onClick={onClick}
    onKeyDown={onActivateKey(onClick)}
    role="switch"
    tabIndex={0}
    aria-checked={!!on}
    aria-label={ariaLabel}
    className={`toggle-track cursor-pointer ${on ? 'active' : ''}`}
  >
    <div className="toggle-thumb" />
  </div>
);

export const ToggleRow = ({ title, subtitle, on, onClick, className = '', pad = 'p-4' }) => (
  <div className={`flex items-center justify-between ${pad} rounded-xl bg-white/[0.03] border border-white/5 ${className}`}>
    <div>
      <p className="text-sm font-medium text-white">{title}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
    <Toggle on={on} onClick={onClick} ariaLabel={typeof title === 'string' ? title : undefined} />
  </div>
);
