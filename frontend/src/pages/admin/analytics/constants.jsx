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

/*
 * `chip` and `SampleTabNotice` used to live here: a per-card "Sample" pill and a whole-tab
 * "Illustrative data." banner, both labelling figures a seeded generator had produced.
 *
 * They are gone because there is nothing left to label. Traffic and Anonymous surfers became
 * measured; the six-month price trend, the per-listing price table, the weekly SLA compliance line
 * and the whole Seasonal tab were deleted rather than rebuilt, because each needed a history
 * nothing on this platform writes and a chart that cannot be sourced does not become sourceable by
 * being labelled (D252). Ticket pickup, service delivery and the concierge pipeline became real,
 * from `audit_log`.
 *
 * Deleted rather than kept for the next generated card, deliberately. Their availability is what
 * made adding one feel legitimate — the label made it look like a disclosed approximation rather
 * than a number nobody measured sitting in the same grid, in the same typeface, beside numbers
 * somebody did. `live-analytics-page.spec.js` asserts no analytics tab renders either string.
 */

/**
 * Banner for a tab whose server read failed.
 *
 * The two tabs that read the API must be able to say "we could not measure this", because the
 * alternative is worse than an error: an empty report renders a full KPI strip reading zero
 * overpriced areas and zero listings awaiting review, which is an all-clear assembled out of a 500.
 * An operator acting on that would conclude there was nothing to do.
 *
 * `role="alert"` because this appears after a load rather than with the page, so it needs announcing.
 */
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
