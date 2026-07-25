import { Link } from 'react-router';
import { BarChart, LineChart } from '../../../components/charts/index.jsx';
import { fmtINR, fmtNum, classNames } from '../../../lib/format.js';
import { C, AX, axis, Card } from './constants.jsx';

export default function PricingTab({ pricing }) {
  if (!pricing) return null;
  return (
    <div className="space-y-6">
      {/* KPI summary */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        {[
          [pricing.summary.totalAnalysed, 'Listings analysed', 'text-white'],
          [pricing.summary.fair, 'Fair priced', 'text-emerald-400'],
          [pricing.summary.overpriced, 'Overpriced', 'text-rose-400'],
          [pricing.summary.underpriced, 'Underpriced', 'text-amber-400'],
          [pricing.summary.avgYield + '%', 'Avg rental yield', 'text-teal-400'],
          [fmtINR(pricing.summary.highestRate), 'Highest ₹/sqft', 'text-indigo-400'],
          [fmtINR(pricing.summary.lowestRate), 'Lowest ₹/sqft', 'text-sky-400'],
        ].map(([val, label, color]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className={`text-2xl font-bold ${color}`}>{val}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Market rate vs actual ₹/sqft" desc="Per locality" height={340}>
          <BarChart labels={pricing.locStats.map((l) => l.name)} datasets={[{ label: 'Market rate', data: pricing.locStats.map((l) => l.marketRate), color: C.indigo }, { label: 'Actual rate', data: pricing.locStats.map((l) => l.avgActualRate), color: C.teal }]} options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8', callback: (v) => `₹${(v / 1000).toFixed(0)}k` } }) } }} />
        </Card>
        <Card title="Rental yield by locality" desc="Annual rent / property value %" height={340}>
          <BarChart horizontal labels={pricing.yieldRanking.map((l) => l.name)} datasets={[{ label: 'Yield %', data: pricing.yieldRanking.map((l) => l.rentalYield), color: C.emerald }]} options={{ scales: { x: axis({ ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }), y: AX } }} />
        </Card>
      </div>

      <Card title="Price trend — ₹/sqft (6 months)" desc="Top 8 localities" height={300}>
        <LineChart labels={pricing.priceTrends[0]?.trend.map((t) => t.month) || []} datasets={pricing.priceTrends.map((loc, i) => ({ label: loc.name, data: loc.trend.map((t) => t.rate), color: [C.teal, C.indigo, C.coral, C.emerald, C.amber, C.rose, C.violet, C.slate][i], fill: false }))} options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8', callback: (v) => `₹${(v / 1000).toFixed(1)}k` } }) } }} />
      </Card>

      {/* Price position table */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Listing Price Position</h3>
        <p className="text-xs text-gray-500 mb-4">How each listing is priced relative to market.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-white/10"><th className="text-left py-2 font-medium">Listing</th><th className="text-left py-2 font-medium">Locality</th><th className="text-center py-2 font-medium">Deal</th><th className="text-right py-2 font-medium">Price</th><th className="text-right py-2 font-medium">Market est.</th><th className="text-right py-2 font-medium">Deviation</th><th className="text-right py-2 font-medium">Views</th><th className="text-center py-2 font-medium">Status</th></tr></thead>
            <tbody>
              {[...pricing.pricePositions].sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation)).slice(0, 20).map((p) => (
                <tr key={p.id} className="border-b border-white/5">
                  <td className="py-2.5 text-white font-medium"><Link to={`/admin/properties?review=${p.id}`} className="hover:text-teal-300 transition-colors">{p.title}</Link></td>
                  <td className="py-2.5 text-gray-400">{p.locality}</td>
                  <td className="py-2.5 text-center"><span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${p.deal === 'rent' ? 'bg-teal-500/15 text-teal-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{p.deal}</span></td>
                  <td className="py-2.5 text-right tabular-nums text-white">{fmtINR(p.price)}</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-400">{fmtINR(p.marketPrice)}</td>
                  <td className={classNames('py-2.5 text-right tabular-nums font-semibold', p.label === 'overpriced' ? 'text-rose-300' : p.label === 'underpriced' ? 'text-amber-300' : 'text-emerald-300')}>{p.deviation > 0 ? '+' : ''}{p.deviation}%</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-400">{fmtNum(p.views)}</td>
                  <td className="py-2.5 text-center">
                    {p.label === 'overpriced' ? <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">Overpriced</span>
                    : p.label === 'underpriced' ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">Underpriced</span>
                    : <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">Fair</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Locality pricing breakdown */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Locality Pricing Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-white/10"><th className="text-left py-2 font-medium">Locality</th><th className="text-right py-2 font-medium">₹/sqft</th><th className="text-right py-2 font-medium">Avg rent</th><th className="text-right py-2 font-medium">Yield %</th><th className="text-right py-2 font-medium">Buy</th><th className="text-right py-2 font-medium">Rent</th><th className="text-right py-2 font-medium">Demand</th><th className="text-center py-2 font-medium">Opportunity</th></tr></thead>
            <tbody>
              {[...pricing.locStats].sort((a, b) => b.demand - a.demand).map((l) => (
                <tr key={l.name} className="border-b border-white/5">
                  <td className="py-2.5 text-white font-medium">{l.name}</td>
                  <td className="py-2.5 text-right tabular-nums text-indigo-300">{fmtINR(l.marketRate)}</td>
                  <td className="py-2.5 text-right tabular-nums text-teal-300">{fmtINR(l.avgRent)}</td>
                  <td className={classNames('py-2.5 text-right tabular-nums font-semibold', l.rentalYield >= 4 ? 'text-emerald-300' : l.rentalYield >= 3 ? 'text-amber-300' : 'text-gray-400')}>{l.rentalYield}%</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-400">{l.buyCount || '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-400">{l.rentCount || '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-sky-300">{l.demand}</td>
                  <td className="py-2.5 text-center">
                    {l.demand >= 85 && l.totalListings <= 2 ? <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">High opportunity</span>
                    : l.demand >= 75 ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">Moderate</span>
                    : <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">Stable</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
