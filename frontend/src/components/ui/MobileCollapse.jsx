import { useId, useState } from 'react';
import Icon from '../Icon.jsx';

/* A section that collapses on phones/tablets (tap the header row) but stays
   permanently open from lg: upward. Same idea as `CollapsibleCard` in
   dashboard/ProfileTab.jsx and `FooterCol` in layout/Footer.jsx, generalised so
   the property page can reuse it without a third copy.

   The difference from those two: the toggle is an *overlay* button rather than a
   wrapper around the heading. Property headings are wrapped in <Tip> (which
   clones its child and makes it focusable), and nesting that inside a <button>
   would produce interactive-in-interactive markup. Laying a transparent
   lg:hidden button over the header row keeps the existing heading markup
   byte-for-byte identical while still giving phones a full-row 44px tap target.

   Desktop renders exactly as before: the button is `lg:hidden` and the panel is
   `lg:block`, so no JS breakpoint detection and no desktop regression. */
export default function MobileCollapse({
  header,
  summary,
  label,
  defaultOpen = false,
  className = '',
  headerClassName = '',
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className={className}>
      <div className={'relative flex items-center justify-between gap-3 min-h-[44px] pr-7 lg:min-h-0 lg:pr-0 ' + headerClassName}>
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
