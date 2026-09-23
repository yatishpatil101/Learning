import { onActivateKey } from '../../../lib/onActivateKey.js';

export const Pill = ({ selected, onClick, children, className = '', dataErr, ariaLabel, role = 'button' }) => (
  <div
    onClick={onClick}
    onKeyDown={onActivateKey(onClick)}
    role={role}
    tabIndex={0}
    {...(role === 'radio' ? { 'aria-checked': !!selected } : { 'aria-pressed': !!selected })}
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
    // The track is 26px tall, under the 44px touch floor, and its drawn height is
    // load-bearing (the thumb travels it), so .tap-extend carries the target instead.
    className={`toggle-track tap-extend cursor-pointer ${on ? 'active' : ''}`}
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
