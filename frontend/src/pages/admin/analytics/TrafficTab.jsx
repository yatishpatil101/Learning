import { Download } from 'lucide-react';
import { DoughnutChart, LineChart } from '../../../components/charts/index.jsx';
import Select from '../../../components/ui/Select.jsx';
import { exportCsv } from '../../../lib/csv.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { C, AX, axis, RANGE_OPTIONS, Card, LoadFailedNotice } from './constants.jsx';

/**
 * Traffic — measured, now that `POST /page-views` collects and an hourly rollup aggregates.
 *
 * Every card here reads `GET /admin/analytics/traffic`, so the tab-wide `Sample` banner is gone and
 * so are the three per-card `Sample` chips. The card that is *absent* rather than merely un-chipped
 * is the old "New vs returning" split: the session id is minted per browser tab and dies with it,
 * so a returning visitor is structurally underivable rather than unimplemented. Anonymous vs
 * signed-in takes its place, because that one can actually be answered.
 */
export default function TrafficTab({ report, failed, days, setDays }) {
  const { toast } = useToast();

  const exportTraffic = () => {
    exportCsv(
      `punenest-traffic-${days}d.csv`,
      ['Date', 'Sessions', 'Page views', 'Signups'],
      (report?.series || []).map((x) => [x.date, x.sessions, x.pageviews, x.signups]),
    );
    toast(`Exported ${days}-day traffic CSV`);
  };

  const picker = (
    <div className="pn-card mb-4 flex flex-wrap items-center gap-3 p-3">
      <span className="text-sm text-gray-400">Traffic window</span>
      <div style={{ maxWidth: 170 }}>
        <Select value={String(days)} onChange={(v) => setDays(Number(v))} options={RANGE_OPTIONS} ariaLabel="Traffic window" />
      </div>
      <button
        className="pn-btn pn-btn-ghost ml-auto inline-flex items-center gap-2"
        onClick={exportTraffic}
        disabled={!report}
      >
        <Download className="h-4 w-4" /> Export traffic CSV
      </button>
    </div>
  );

  /*
   * The picker is rendered by the single return below rather than by each branch, and that is
   * load-bearing rather than tidiness.
   *
   * Returning `picker` bare while loading and `<div>{picker}...</div>` once loaded puts a `div` at
   * the root of both, so React keeps the DOM node and swaps its children instead of remounting.
   * The window control is inside those children, so it was destroyed and rebuilt the moment its own
   * fetch resolved — with the dropdown open, which is exactly when a user has just changed it. The
   * panel vanished mid-click and the change was lost. It reproduced 4 runs in 6.
   *
   * One shape for all three states means the control survives its own reload.
   */
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
    // Sessions, not rows. The endpoint returns its whole closed channel vocabulary every time,
    // zeroes included, so `sources.length` is five in a window nobody visited and the empty state
    // below would never have shown. What renders instead is a doughnut of five nothing-slices,
    // which looks like a measurement.
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
              options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8', callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } }) } }}
            />
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/*
            Sessions, not page views: a source describes how somebody arrived, and counting their
            views would weight that arrival by how much they went on to read, then present it as
            reach. There is no paid-ads slice and there cannot be one — identifying paid traffic
            needs `utm_source`, which the collector strips from the query string before it sends.
          */}
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
      {picker}
      {body()}
    </div>
  );
}
