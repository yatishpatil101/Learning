import { useId } from 'react';
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

export { default as FieldError } from '../../../components/ui/FieldError.jsx';

export const Toggle = ({ on, onClick, ariaLabel }) => (
  <div
    onClick={onClick}
    onKeyDown={onActivateKey(onClick)}
    role="switch"
    tabIndex={0}
    aria-checked={!!on}
    aria-label={ariaLabel}
    className={`toggle-track tap-extend cursor-pointer ${on ? 'active' : ''}`}
  >
    <div className="toggle-thumb" />
  </div>
);

export const ToggleRow = ({ title, subtitle, on, onClick, className = '', pad = 'p-4' }) => {
  const subtitleId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={typeof title === 'string' ? title : undefined}
      aria-describedby={subtitle ? subtitleId : undefined}
      onClick={onClick}
      className={`flex w-full items-center justify-between text-left ${pad} rounded-xl bg-white/[0.03] border border-white/5 ${className}`}
    >
      <span>
        <span className="block text-sm font-medium text-white">{title}</span>
        {subtitle && <span id={subtitleId} className="block text-xs text-gray-500 mt-0.5">{subtitle}</span>}
      </span>
      <span aria-hidden="true" className={`toggle-track ${on ? 'active' : ''}`}>
        <span className="toggle-thumb" />
      </span>
    </button>
  );
};
