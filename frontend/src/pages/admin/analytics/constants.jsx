import { Children, cloneElement, isValidElement } from 'react';
import { cssColour } from '../../../lib/themeColour';

export const C = {
  get teal() { return cssColour('teal-500'); },
  get indigo() { return cssColour('indigo-500'); },
  get coral() { return cssColour('orange-400'); },
  get emerald() { return cssColour('emerald-500'); },
  get rose() { return cssColour('rose-500'); },
  get amber() { return cssColour('amber-500'); },
  get slate() { return cssColour('slate-500'); },
  get violet() { return cssColour('violet-400'); },
};

export const AX = {
  get ticks() { return { color: cssColour('slate-400') }; },
  get grid() { return { color: cssColour('white', 0.05) }; },
};
export const axis = (extra = {}) => ({ ...AX, ...extra, ticks: { color: cssColour('slate-400'), ...(extra.ticks || {}) } });

export const RANGE_OPTIONS = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 180 days' },
];

export function Card({ title, desc, action, children, height = 240 }) {
  // Charts own their (definite) height; pass the card's height down to chart
  // children that don't set their own so per-card sizing is preserved.
  const kids = Children.map(children, (c) =>
    isValidElement(c) && typeof c.type === 'function' && c.props.height == null
      ? cloneElement(c, { height })
      : c,
  );
  return (
    <div className="dz-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">{title}</h3>
          {desc ? <div className="text-xs text-gray-400">{desc}</div> : null}
        </div>
        {action}
      </div>
      {kids}
    </div>
  );
}

/* API-backed tabs must not turn a 500 into zeroed KPIs that read as an all-clear.
   `role="alert"` announces this late-mounted failure state. */
export function LoadFailedNotice({ children }) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-4 py-3 text-xs text-rose-200/90"
    >
      <strong className="font-semibold">This report could not be loaded.</strong> {children}
    </div>
  );
}
