import { BarChart } from '../../../components/charts/index.jsx';
import { pageLabel } from '../../../lib/telemetry/pageLabels.js';
import { C, AX, axis, Card, LoadFailedNotice } from './constants.jsx';

/**
 * How much of the audience browses without an account, and where it leaves.
 *
 * Three defects died with the generated version, all of them invisible on screen:
 *
 * - `anonPct` and `conversionRate` arrived as `.toFixed()` **strings** while the two tiles beside
 *   them called `.toLocaleString('en-IN')`, so the row rendered only because the string tiles never
 *   reached that call. They are numbers now, and null when there were no sessions to divide by.
 * - The per-page "signup rate" series multiplied an already-percentage value by 100 and plotted
 *   210-680 on an axis carrying tens of thousands of views. Attributing a signup to a page needs a
 *   landing page joined to a new account, which is exactly the traffic-to-identity join the
 *   collector is built not to make, so the series is gone rather than fixed. Anonymous views
 *   against total views answers the same question with data that exists.
 * - The KPI tile and the weekly chart derived signed-in sessions from two different multipliers
 *   (`×12` and `×(11 + r()*3)`), so the headline and the chart under it already disagreed.
 */
export default function SurfersTab({ report, failed, days }) {
  if (failed) {
    return (
      <LoadFailedNotice>
        The anonymous-audience report is unavailable for this window.
      </LoadFailedNotice>
    );
  }
  if (!report) return null;

  const {
    totalSessions, anonSessions, signups, anonSharePct, conversionRatePct, weeks, pages, dropOff,
  } = report;

  // A rate with no denominator is not zero, it is unknown, and every one of these arrives nullable
  // for that reason. `—` is the same mark the Pricing tab uses for an unmeasurable figure; a count
  // of 0 still prints as 0, because no sessions is a measurement.
  const pct = (v) => (v == null ? '—' : `${v}%`);
  const num = (v) => v.toLocaleString('en-IN');

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          [pct(anonSharePct), 'Anonymous share', 'Portion of sessions that never signed in'],
          [pct(conversionRatePct), 'Session \u2192 Signup rate', 'Signups over sessions in this window'],
          [num(anonSessions), 'Anonymous sessions', `Out of ${num(totalSessions)} total sessions`],
          [num(signups), 'Signups in period', `Last ${days} days`],
        ].map(([val, label, sub]) => (
          <div key={label + sub} className="dz-card p-4 text-center">
            <p className="text-2xl font-extrabold text-teal-400">{val}</p>
            <p className="mt-1 text-sm font-semibold text-white">{label}</p>
            <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
          </div>
        ))}
      </div>

      <div className="mb-5 grid gap-6 lg:grid-cols-2">
        <Card title="Anonymous vs signed-in sessions" desc="Per ISO week" height={260}>
          <BarChart labels={weeks.map((w) => w.week)} datasets={[{ label: 'Anonymous', data: weeks.map((w) => w.anonymous), color: C.coral, stack: 's' }, { label: 'Signed-in', data: weeks.map((w) => w.signedIn), color: C.teal, stack: 's' }]} options={{ scales: { x: axis({ stacked: true }), y: axis({ stacked: true, ticks: { color: '#94a3b8', callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } }) } }} />
        </Card>
        {/*
          `sharePct` is a share of the exits *shown*, not of all exits, because the list is capped.
          The card says "top exit points" for that reason: reading a bar as "38% of everyone who
          left, left here" would be wrong by however long the tail is.
        */}
        <Card title="Where visitors leave" desc="Share of the top exit points" height={260}>
          {dropOff.length ? (
            <BarChart horizontal labels={dropOff.map((d) => pageLabel(d.path))} datasets={[{ label: '% of shown exits', data: dropOff.map((d) => d.sharePct), color: C.rose }]} options={{ scales: { x: axis({ ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }), y: AX } }} />
          ) : (
            <p className="py-10 text-center text-sm text-gray-500">No exits recorded in this window.</p>
          )}
        </Card>
      </div>

      <Card title="Pages visited by anonymous users" desc="Anonymous views against total views per page" height={320}>
        {pages.length ? (
          <BarChart labels={pages.map((p) => pageLabel(p.path))} datasets={[{ label: 'Anonymous views', data: pages.map((p) => p.anonViews), color: C.slate }, { label: 'All views', data: pages.map((p) => p.views), color: C.emerald }]} options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8', callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } }) } }} />
        ) : (
          <p className="py-10 text-center text-sm text-gray-500">No page views in this window.</p>
        )}
      </Card>
    </div>
  );
}
