import { BarChart } from '../../../components/charts/index.jsx';
import { pageLabel } from '../../../lib/telemetry/pageLabels.js';
import { fmtNum } from '../../../lib/format.js';
import { C, AX, axis, Card, LoadFailedNotice } from './constants.jsx';

// How much of the audience browses without an account, and where it leaves.
export default function AudiencePanel({ report, failed, days }) {
  if (failed) {
    return (
      <LoadFailedNotice>
        The anonymous-audience report is unavailable for this window.
      </LoadFailedNotice>
    );
  }
  if (!report) return null;

  const {
    totalSessions, anonSessions, signups, anonSharePct, conversionRatePct, pages, dropOff,
  } = report;

  // Rates arrive nullable because a missing denominator is unknown, not zero; `—` matches the Pricing tab, while a 0 count still prints 0.
  const pct = (v) => (v == null ? '—' : `${v}%`);

  return (
    <div>
      <div className="mb-5 mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          [pct(anonSharePct), 'Anonymous share', 'Portion of sessions that never signed in'],
          [pct(conversionRatePct), 'Session \u2192 Signup rate', 'Signups over sessions in this window'],
          [fmtNum(anonSessions), 'Anonymous sessions', `Out of ${fmtNum(totalSessions)} total sessions`],
          [fmtNum(signups), 'Signups in period', `Last ${days} days`],
        ].map(([val, label, sub]) => (
          <div key={label + sub} className="dz-card p-4 text-center">
            <p className="text-2xl font-extrabold text-teal-400">{val}</p>
            <p className="mt-1 text-sm font-semibold text-white">{label}</p>
            <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* `sharePct` is a share of the exits shown (the list is capped), not of all exits. */}
        <Card title="Where visitors leave" desc="Share of the top exit points" height={260}>
          {dropOff.length ? (
            <BarChart horizontal labels={dropOff.map((d) => pageLabel(d.path))} datasets={[{ label: '% of shown exits', data: dropOff.map((d) => d.sharePct), color: C.rose }]} options={{ scales: { x: axis({ ticks: { callback: (v) => `${v}%` } }), y: AX } }} />
          ) : (
            <p className="py-10 text-center text-sm text-gray-500">No exits recorded in this window.</p>
          )}
        </Card>

        <Card title="Pages visited by anonymous users" desc="Anonymous views against total views per page" height={260}>
          {pages.length ? (
            <BarChart labels={pages.map((p) => pageLabel(p.path))} datasets={[{ label: 'Anonymous views', data: pages.map((p) => p.anonViews), color: C.slate }, { label: 'All views', data: pages.map((p) => p.views), color: C.emerald }]} options={{ scales: { x: AX, y: axis({ ticks: { callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } }) } }} />
          ) : (
            <p className="py-10 text-center text-sm text-gray-500">No page views in this window.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
