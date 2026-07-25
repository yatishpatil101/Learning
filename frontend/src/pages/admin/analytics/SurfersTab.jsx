import { BarChart } from '../../../components/charts/index.jsx';
import { C, AX, axis, Card } from './constants.jsx';

export default function SurfersTab({ surfers, days }) {
  if (!surfers) return null;
  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          [surfers.anonPct + '%', 'Anonymous sessions', 'Visitors who browse without signing up'],
          [surfers.conversionRate + '%', 'Visitor \u2192 Signup rate', 'Overall conversion from visit to registration'],
          [surfers.anonSessions.toLocaleString('en-IN'), 'Anonymous visits', `Out of ${surfers.totalVisits.toLocaleString('en-IN')} total visits`],
          [surfers.totalSignups.toLocaleString('en-IN'), 'Signups in period', `Last ${days} days`],
        ].map(([val, label, sub]) => (
          <div key={label} className="pn-card p-4 text-center">
            <p className="text-2xl font-extrabold text-teal-400">{val}</p>
            <p className="mt-1 text-sm font-semibold text-white">{label}</p>
            <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
          </div>
        ))}
      </div>

      <div className="mb-5 grid gap-6 lg:grid-cols-2">
        <Card title="Anonymous vs signed-in sessions" desc="Weekly split" height={260}>
          <BarChart labels={surfers.weeks.map((w) => w.week)} datasets={[{ label: 'Anonymous', data: surfers.weeks.map((w) => w.anon), color: C.coral, stack: 's' }, { label: 'Signed-in', data: surfers.weeks.map((w) => w.signedIn), color: C.teal, stack: 's' }]} options={{ scales: { x: axis({ stacked: true }), y: axis({ stacked: true, ticks: { color: '#94a3b8', callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } }) } }} />
        </Card>
        <Card title="Where anonymous users leave" desc="Top exit points without signing up" height={260}>
          <BarChart horizontal labels={surfers.dropOff.map((d) => d.page)} datasets={[{ label: '% exits', data: surfers.dropOff.map((d) => d.pct), color: C.rose }]} options={{ scales: { x: axis({ ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }), y: AX } }} />
        </Card>
      </div>

      <Card title="Pages visited by anonymous users" desc="Views and signup conversion rate per page" height={320}>
        <BarChart labels={surfers.anonPages.map((p) => p.page)} datasets={[{ label: 'Anonymous views', data: surfers.anonPages.map((p) => p.views), color: C.slate }, { label: 'Signup rate %', data: surfers.anonPages.map((p) => p.signupRate * 100), color: C.emerald }]} options={{ scales: { x: AX, y: axis({ position: 'left', ticks: { color: '#94a3b8', callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } }) } }} />
      </Card>
    </div>
  );
}
