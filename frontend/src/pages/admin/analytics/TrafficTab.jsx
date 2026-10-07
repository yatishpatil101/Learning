import { Download } from 'lucide-react';
import { DoughnutChart, LineChart } from '../../../components/charts/index.jsx';
import { exportCsv } from '../../../lib/csv.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { C, AX, axis, Card, LoadFailedNotice } from './constants.jsx';
import AudiencePanel from './AudiencePanel.jsx';

/** No 'New vs returning' card: the session id dies with the
 * tab, so a returning visitor is structurally underivable. */
export default function TrafficTab({ report, failed, audience, audienceFailed, days }) {
  const { toast } = useToast();

  const exportTraffic = () => {
    exportCsv(
      `draazy-traffic-${days}d.csv`,
      ['Date', 'Sessions', 'Page views', 'Signups'],
      (report?.series || []).map((x) => [x.date, x.sessions, x.pageviews, x.signups]),
    );
    toast(`Exported ${days}-day traffic CSV`);
  };

  const body = () => {
    if (failed) {
      return (
        <LoadFailedNotice>
          Sessions, page views and sources are unavailable. Nothing is drawn rather than zeroes,
          because a zero here would read as nobody having visited.
        </LoadFailedNotice>
      );
    }
    // Pre-arrival. Distinct from a loaded report over an empty window, which does render — as the
    // flat zero line that actually happened.
    if (!report) return null;

    const { series, sources, devices, identity } = report;
    const deviceTotal = devices.mobile + devices.tablet + devices.desktop;
    // Count sessions, not rows: the endpoint returns every channel
    // with zeroes, so rows.length would hide the empty state.
    const sourceTotal = sources.reduce((sum, s) => sum + s.sessions, 0);

    return (
      <>
        <div className="mb-5">
          <Card title="Sessions & page views" desc={`Last ${days} days`} height={280}>
            <LineChart
              labels={series.map((x) => x.date.slice(5))}
              datasets={[
                { label: 'Sessions', data: series.map((x) => x.sessions), color: C.teal, fill: true },
                { label: 'Page views', data: series.map((x) => x.pageviews), color: C.indigo, fill: false },
              ]}
              options={{ scales: { x: AX, y: axis({ ticks: { callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } }) } }}
            />
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Sessions, not page views, so arrival isn't weighted by reading
              depth; no paid slice as the collector strips utm_source. */}
          <Card title="Traffic sources" desc="Sessions by channel">
            {sourceTotal ? (
              <DoughnutChart
                labels={sources.map((s) => s.channel)}
                values={sources.map((s) => s.sessions)}
                colors={[C.teal, C.indigo, C.emerald, C.coral, C.violet]}
              />
            ) : (
              <p className="py-10 text-center text-sm text-gray-500">No sessions in this window.</p>
            )}
          </Card>

          {/* Also per session, attributed to the session's first view — one arrival is one device. */}
          <Card title="Device split" desc="Sessions by device">
            {deviceTotal ? (
              <DoughnutChart
                labels={['Mobile', 'Desktop', 'Tablet']}
                values={[devices.mobile, devices.desktop, devices.tablet]}
                colors={[C.teal, C.indigo, C.amber]}
              />
            ) : (
              <p className="py-10 text-center text-sm text-gray-500">No sessions in this window.</p>
            )}
          </Card>

          <Card title="Anonymous vs signed-in" desc="Sessions per ISO week">
            <LineChart
              labels={identity.map((w) => w.week)}
              datasets={[
                { label: 'Anonymous', data: identity.map((w) => w.anonymous), color: C.coral, fill: false },
                { label: 'Signed-in', data: identity.map((w) => w.signedIn), color: C.teal, fill: false },
              ]}
              options={{ scales: { x: AX, y: axis() } }}
            />
          </Card>
        </div>
      </>
    );
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          className="dz-btn dz-btn-ghost inline-flex items-center gap-2"
          onClick={exportTraffic}
          disabled={!report}
        >
          <Download className="h-4 w-4" /> Export traffic CSV
        </button>
      </div>
      {body()}
      <AudiencePanel report={audience} failed={audienceFailed} days={days} />
    </div>
  );
}
