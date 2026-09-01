import { BarChart, LineChart } from '../../../components/charts/index.jsx';
import { pageLabel } from '../../../lib/telemetry/pageLabels.js';
import { C, AX, axis, Card, LoadFailedNotice } from './constants.jsx';

/**
 * Engagement — session length, bounce rate and the most-viewed pages, all measured.
 *
 * Two things changed beyond the data source.
 *
 * The weekly labels were `WK12`, a constant twelve-item array, so the charts drew "W1..W12"
 * regardless of the window and regardless of which weeks had any traffic. They are real ISO weeks
 * anchored to Monday now, and the server zero-fills them, so a quiet fortnight shows as a gap
 * rather than being closed up into a smooth line.
 *
 * "Top pages by views" plotted a dataset labelled `Index` running `[100, 86, 74 ...]` — a 0-100
 * scale pinned at 100 for the leader, so the top page looked equally dominant whether it had had
 * ten thousand views or nine. It plots real counts now.
 */
export default function EngagementTab({ report, failed, days }) {
  if (failed) {
    return (
      <LoadFailedNotice>
        Session length, bounce rate and page ranking are unavailable for this window.
      </LoadFailedNotice>
    );
  }
  if (!report) return null;

  const { weeks, topPages } = report;

  return (
    <div>
      <div className="mb-5 grid gap-6 lg:grid-cols-2">
        {/*
          Both series are nullable and are passed through as null rather than coerced to 0. A week
          with no sessions has no average session length and no bounce rate; charting 0 would claim
          instant departures and a perfect read-through respectively, about a week that had nobody
          to make claims about. Chart.js renders a null as a gap, which is the honest mark.
        */}
        <Card title="Avg. session duration" desc={`Minutes per session · last ${days} days`}>
          <LineChart
            labels={weeks.map((w) => w.week)}
            datasets={[{ label: 'Minutes', data: weeks.map((w) => w.avgSessionMinutes), color: C.teal, fill: true }]}
            options={{ scales: { x: AX, y: axis() } }}
          />
        </Card>
        <Card title="Bounce rate" desc={`Single-view sessions · last ${days} days`}>
          <LineChart
            labels={weeks.map((w) => w.week)}
            datasets={[{ label: 'Bounce %', data: weeks.map((w) => w.bounceRatePct), color: C.coral, fill: true }]}
            options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }) } }}
          />
        </Card>
      </div>

      <Card title="Top pages by views" desc={`Last ${days} days`} height={300}>
        {topPages.length ? (
          <BarChart
            horizontal
            labels={topPages.map((p) => pageLabel(p.path))}
            datasets={[{ label: 'Views', data: topPages.map((p) => p.views), color: C.indigo }]}
            options={{ scales: { x: axis({ ticks: { color: '#94a3b8', callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } }), y: AX } }}
          />
        ) : (
          <p className="py-10 text-center text-sm text-gray-500">No page views in this window.</p>
        )}
      </Card>
    </div>
  );
}
