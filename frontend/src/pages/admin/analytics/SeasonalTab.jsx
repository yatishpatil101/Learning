import { LineChart } from '../../../components/charts/index.jsx';
import { classNames } from '../../../lib/format.js';
import { C, AX, axis, Card } from './constants.jsx';

export default function SeasonalTab({ seasonal }) {
  if (!seasonal) return null;
  return (
    <div className="space-y-6">
      {/* Recommendations */}
      {seasonal.recommendations.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {seasonal.recommendations.map((rec, i) => (
            <div key={i} className={classNames('rounded-xl border p-4', rec.type === 'opportunity' ? 'border-emerald-500/20 bg-emerald-500/5' : rec.type === 'caution' ? 'border-amber-500/20 bg-amber-500/5' : 'border-sky-500/20 bg-sky-500/5')}>
              <div className={classNames('text-xs font-bold uppercase tracking-wide mb-1', rec.type === 'opportunity' ? 'text-emerald-400' : rec.type === 'caution' ? 'text-amber-400' : 'text-sky-400')}>{rec.type}</div>
              <p className="text-sm text-gray-300">{rec.text}</p>
            </div>
          ))}
        </div>
      )}

      <Card title="Monthly demand pattern" desc="Rental, buying & site visit demand indexed to 100" height={280}>
        <LineChart labels={seasonal.months} datasets={[{ label: 'Rental demand', data: seasonal.monthlyDemand.map((d) => d.rental), color: C.teal, fill: false }, { label: 'Buying demand', data: seasonal.monthlyDemand.map((d) => d.buying), color: C.indigo, fill: false }, { label: 'Site visits', data: seasonal.monthlyDemand.map((d) => d.visits), color: C.coral, fill: false }]} options={{ scales: { x: AX, y: axis({ min: 50, max: 150, ticks: { color: '#94a3b8', callback: (v) => v } }) } }} />
      </Card>

      {/* Seasonal events */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Key seasonal events — Pune market</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {seasonal.events.map((ev) => (
            <div key={ev.month + ev.label} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-xs font-bold text-gray-300">{ev.month}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-200 truncate">{ev.label}</div>
                <span className={classNames('text-[10px] font-semibold uppercase', ev.direction === 'up' ? 'text-emerald-400' : 'text-rose-400')}>{ev.direction === 'up' ? '↑' : '↓'} {ev.impact}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Card title="Year-over-year demand growth" desc="3-year trend" height={260}>
        <LineChart labels={seasonal.months} datasets={[{ label: '2024', data: seasonal.yoyGrowth.map((d) => d.year1), color: C.slate, fill: false }, { label: '2025', data: seasonal.yoyGrowth.map((d) => d.year2), color: C.amber, fill: false }, { label: '2026', data: seasonal.yoyGrowth.map((d) => d.year3), color: C.teal, fill: false }]} options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8' } }) } }} />
      </Card>

      {/* Locality seasonal table */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Locality seasonal profiles</h3>
        <p className="text-xs text-gray-500 mb-4">Peak and slow months for each area</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-white/10"><th className="text-left py-2 font-medium">Locality</th><th className="text-center py-2 font-medium">Focus</th><th className="text-left py-2 font-medium">Peak months</th><th className="text-left py-2 font-medium">Slow months</th><th className="text-right py-2 font-medium">Peak demand</th><th className="text-right py-2 font-medium">Low demand</th><th className="text-right py-2 font-medium">Swing</th></tr></thead>
            <tbody>
              {[...seasonal.localitySeasons].sort((a, b) => (b.peakDemand - b.lowDemand) - (a.peakDemand - a.lowDemand)).map((loc) => (
                <tr key={loc.name} className="border-b border-white/5">
                  <td className="py-2.5 font-medium text-white">{loc.name}</td>
                  <td className="py-2.5 text-center"><span className={classNames('inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase', loc.focus === 'Rent' ? 'bg-teal-500/15 text-teal-300' : loc.focus === 'Buy' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-amber-500/15 text-amber-300')}>{loc.focus}</span></td>
                  <td className="py-2.5 text-emerald-300 text-xs font-medium">{loc.peakMonths.join(', ')}</td>
                  <td className="py-2.5 text-rose-300 text-xs font-medium">{loc.slowMonths.join(', ')}</td>
                  <td className="py-2.5 text-right tabular-nums text-emerald-300 font-semibold">{loc.peakDemand}</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-400">{loc.lowDemand}</td>
                  <td className="py-2.5 text-right tabular-nums font-semibold text-amber-300">{loc.peakDemand - loc.lowDemand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Card title="Seasonal demand curves — top localities" desc="Monthly demand index by area" height={300}>
        <LineChart labels={seasonal.months} datasets={seasonal.localitySeasons.slice(0, 6).map((loc, i) => ({ label: loc.name, data: loc.curve.map((c) => c.demand), color: [C.teal, C.indigo, C.coral, C.emerald, C.amber, C.violet][i], fill: false }))} options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8' } }) } }} />
      </Card>
    </div>
  );
}
