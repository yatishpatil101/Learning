import { Download } from 'lucide-react';
import { BarChart, DoughnutChart, LineChart } from '../../../components/charts/index.jsx';
import Select from '../../../components/ui/Select.jsx';
import { exportCsv } from '../../../lib/csv.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { C, AX, axis, RANGE_OPTIONS, WK8, Card } from './constants.jsx';

export default function TrafficTab({ traffic, days, setDays, sources }) {
  const { toast } = useToast();

  const exportTraffic = () => {
    exportCsv(
      `punenest-traffic-${days}d.csv`,
      ['Date', 'Visits', 'Page views', 'Signups'],
      traffic.map((x) => [x.date, x.visits, x.pageviews, x.signups]),
    );
    toast(`Exported ${days}-day traffic CSV`);
  };

  return (
    <div>
      <div className="pn-card mb-4 flex flex-wrap items-center gap-3 p-3">
        <span className="text-sm text-gray-400">Traffic window</span>
        <div style={{ maxWidth: 170 }}>
          <Select value={String(days)} onChange={(v) => setDays(Number(v))} options={RANGE_OPTIONS} ariaLabel="Traffic window" />
        </div>
        <button className="pn-btn pn-btn-ghost ml-auto inline-flex items-center gap-2" onClick={exportTraffic}>
          <Download className="h-4 w-4" /> Export traffic CSV
        </button>
      </div>

      <div className="mb-5">
        <Card title="Visits & page views" desc={`Last ${days} days`} height={280}>
          <LineChart
            labels={traffic.map((x) => x.date.slice(5))}
            datasets={[
              { label: 'Visits', data: traffic.map((x) => x.visits), color: C.teal, fill: true },
              { label: 'Page views', data: traffic.map((x) => x.pageviews), color: C.indigo, fill: false },
            ]}
            options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8', callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } }) } }}
          />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Traffic sources">
          <DoughnutChart labels={sources.map((s) => s.k)} values={sources.map((s) => s.v)} colors={[C.teal, C.indigo, C.emerald, C.coral, C.violet]} />
        </Card>
        <Card title="Device split" chip="Sample">
          <DoughnutChart labels={['Mobile', 'Desktop', 'Tablet']} values={[64, 30, 6]} colors={[C.teal, C.indigo, C.amber]} />
        </Card>
        <Card title="New vs returning" chip="Sample">
          <BarChart labels={WK8} datasets={[{ label: 'New', data: [62, 58, 65, 70, 68, 74, 78, 82], color: C.teal, stack: 's' }, { label: 'Returning', data: [38, 42, 40, 44, 48, 46, 52, 55], color: C.indigo, stack: 's' }]} options={{ scales: { x: axis({ stacked: true }), y: axis({ stacked: true }) } }} />
        </Card>
      </div>
    </div>
  );
}
