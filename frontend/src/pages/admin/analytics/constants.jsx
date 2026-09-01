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

export const WK8 = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'];
export const WK12 = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'];

/**
 * Illustrative traffic-source mix for the Traffic tab's doughnut.
 *
 * This lived in `db.json` under `analytics.sources` and reached the tab through
 * `mockApi.getAnalytics()`. It was never anything but a five-row constant — no code read it, wrote
 * it or derived it — so routing it through a localStorage database bought nothing and cost the
 * whole page a `<Loading />` gate: all eight tabs waited on a mock read to render one doughnut.
 *
 * It sits beside `WK8` now because that is what it always was: the same kind of sample as the
 * "Device split" and "New vs returning" charts either side of it, which have carried a `Sample`
 * chip all along. The card it feeds now carries one too. PuneNest has no traffic-source telemetry
 * of any kind, so the honest presentation is the one its neighbours were already using.
 */
export const TRAFFIC_SOURCES = [
  { k: 'Organic search', v: 38 },
  { k: 'Direct', v: 22 },
  { k: 'WhatsApp', v: 16 },
  { k: 'Social', v: 13 },
  { k: 'Paid ads', v: 11 },
];

export function Card({ title, desc, chip, action, children, height = 240 }) {
  // Charts own their (definite) height; pass the card's height down to chart
  // children that don't set their own so per-card sizing is preserved.
  const kids = Children.map(children, (c) =>
    isValidElement(c) && typeof c.type === 'function' && c.props.height == null
      ? cloneElement(c, { height })
      : c,
  );
  return (
    <div className="pn-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">{title}</h3>
          {desc ? <div className="text-xs text-gray-400">{desc}</div> : null}
        </div>
        {chip ? (
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-400" title="Illustrative sample data">{chip}</span>
        ) : null}
        {action}
      </div>
      {kids}
    </div>
  );
}
