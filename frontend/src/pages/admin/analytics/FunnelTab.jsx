import { LineChart } from '../../../components/charts/index.jsx';
import { fmtNum } from '../../../lib/format.js';
import { C, AX, axis, Card, LoadFailedNotice } from './constants.jsx';

const STAGES = [
  { key: 'posted', label: 'Listings posted', get color() { return C.slate; } },
  { key: 'approved', label: 'Approved', get color() { return C.teal; } },
  { key: 'contacts', label: 'Contact requests', get color() { return C.indigo; } },
  { key: 'visits', label: 'Visits booked', get color() { return C.amber; } },
  { key: 'deals', label: 'Deals closed', get color() { return C.emerald; } },
];

/** Share of the previous stage, or null when there was nothing to convert. */
const stepPct = (cur, prev) => (prev > 0 ? Math.round((cur / prev) * 100) : null);

export default function FunnelTab({ report, failed, days }) {
  if (failed) {
    return (
      <LoadFailedNotice>
        The funnel report did not answer, so no stage counts are shown — don&apos;t read this as a quiet week.
      </LoadFailedNotice>
    );
  }
  if (!report) return null;

  const { weeks } = report;
  const totals = STAGES.map((s) => weeks.reduce((sum, w) => sum + w[s.key], 0));
  const steps = totals.map((t, i) => (i === 0 ? null : stepPct(t, totals[i - 1])));
  const drop = steps.reduce(
    (worst, pct, i) => (pct != null && (worst == null || pct < steps[worst]) ? i : worst),
    null,
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
        {STAGES.map((s, i) => (
          <div key={s.key} className="rounded-xl border border-white/10 bg-white/[0.02] p-4" data-testid={`funnel-${s.key}`}>
            <div className="text-2xl font-bold text-white tabular-nums">{fmtNum(totals[i])}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            {i > 0 ? (
              <div className={`text-[11px] mt-1 tabular-nums ${i === drop ? 'text-rose-300' : 'text-gray-400'}`}>
                {steps[i] == null ? '—' : `${steps[i]}%`} of previous
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500">
        {drop == null
          ? 'Not enough activity in this window to compare stages.'
          : `Biggest drop: ${STAGES[drop - 1].label} → ${STAGES[drop].label} (${steps[drop]}%).`}
        {' '}Each stage counts what happened that week, not one group followed through.
      </p>

      <Card title="Stages by week" desc={`Last ${days} days`} height={300}>
        <LineChart
          labels={weeks.map((w) => w.week)}
          datasets={STAGES.map((s) => ({ label: s.label, data: weeks.map((w) => w[s.key]), color: s.color, fill: false }))}
          options={{ scales: { x: AX, y: axis({ beginAtZero: true, ticks: { precision: 0 } }) } }}
        />
      </Card>
    </div>
  );
}
