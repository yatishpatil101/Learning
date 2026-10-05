import { useId, useState } from 'react';
import Icon from '../Icon.jsx';
/* A section that collapses on phones/tablets (tap the header row) but stays permanently open from lg: upward. */

export default function MobileCollapse({
  header,
  summary,
  label,
  defaultOpen = false,
  className = '',
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className={className}>
      <div className="relative flex items-center justify-between gap-3 min-h-[44px] pr-7 lg:min-h-0 lg:pr-0">
        {header}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={label}
          data-mobile-collapse-toggle=""
          className="lg:hidden absolute inset-0 flex items-center justify-end gap-2"
        >
          {!open && summary ? <span className="text-xs font-semibold text-slate-400">{summary}</span> : null}
          <Icon name="chevron-down" className={'w-5 h-5 flex-shrink-0 text-slate-400 transition-transform ' + (open ? 'rotate-180' : '')} />
        </button>
      </div>
      <div id={panelId} data-mobile-collapse-panel="" className={(open ? 'block' : 'hidden') + ' lg:block'}>
        {children}
      </div>
    </div>
  );
}
