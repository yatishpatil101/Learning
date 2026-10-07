import { BarChart, LineChart } from '../../../components/charts/index.jsx';
import { pageLabel } from '../../../lib/telemetry/pageLabels.js';
import { C, AX, axis, Card, LoadFailedNotice } from './constants.jsx';

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
        {/* Series stay null, not 0: a week with no sessions has no
            average length or bounce rate, and Chart.js gaps nulls. */}
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
            options={{ scales: { x: AX, y: axis({ ticks: { callback: (v) => `${v}%` } }) } }}
          />
        </Card>
      </div>

      <Card title="Top pages by views" desc={`Last ${days} days`} height={300}>
        {topPages.length ? (
          <BarChart
            horizontal
            labels={topPages.map((p) => pageLabel(p.path))}
            datasets={[{ label: 'Views', data: topPages.map((p) => p.views), color: C.indigo }]}
            options={{ scales: { x: axis({ ticks: { callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } }), y: AX } }}
          />
        ) : (
          <p className="py-10 text-center text-sm text-gray-500">No page views in this window.</p>
        )}
      </Card>
    </div>
  );
}
