import { Children, cloneElement, isValidElement } from 'react';

export const C = {
  teal: '#14b8a6',
  indigo: '#6366f1',
  coral: '#fb923c',
  emerald: '#10b981',
  rose: '#f43f5e',
  amber: '#f59e0b',
  slate: '#64748b',
  violet: '#a78bfa',
};

export const AX = { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' } };
export const axis = (extra = {}) => ({ ...AX, ...extra, ticks: { color: '#94a3b8', ...(extra.ticks || {}) } });

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
