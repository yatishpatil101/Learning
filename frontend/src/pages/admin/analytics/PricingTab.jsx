import { BarChart } from '../../../components/charts/index.jsx';
import { fmtINR, fmtNum, classNames } from '../../../lib/format.js';
import { C, AX, axis, Card, LoadFailedNotice } from './constants.jsx';

/** Must match `AdminPricingService.MIN_SAMPLE`: fewer approved flats than this get no asking rate. */
const MIN_SAMPLE = 3;

/** Nullable money. A dash, never a zero — the point of the endpoint is that it can say "no data". */
const money = (v) => (v == null ? '—' : fmtINR(v));

/** Nullable percentage, same contract. */
const pct = (v) => (v == null ? '—' : `${v}%`);

/** The Pricing tab: measured locality pricing. Nulls render as dashes, never coerced; `rows` null means not loaded,
 * and `failed` keeps a 500 from rendering as an empty report. */
export default function PricingTab({ rows, failed }) {
  if (failed) {
    return (
      <LoadFailedNotice>
        The pricing endpoint did not answer, so no locality figures are shown. They are deliberately
        left blank rather than defaulted.
      </LoadFailedNotice>
    );
  }
  if (!rows) return null;

  const priced = rows.filter((r) => r.avgActualRatePerSqft != null);
  const rates = priced.map((r) => r.avgActualRatePerSqft);
  const yieldRanking = rows
    .filter((r) => r.rentalYieldPct != null)
    .sort((a, b) => b.rentalYieldPct - a.rentalYieldPct);
  const avgYield = yieldRanking.length
    ? Math.round((yieldRanking.reduce((s, r) => s + r.rentalYieldPct, 0) / yieldRanking.length) * 10) / 10
    : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[
          [fmtNum(priced.length), 'Localities priced', 'text-white'],
          [pct(avgYield), 'Avg rental yield', 'text-teal-400'],
          [money(rates.length ? Math.max(...rates) : null), 'Highest asking rate', 'text-indigo-400'],
          [money(rates.length ? Math.min(...rates) : null), 'Lowest asking rate', 'text-sky-400'],
        ].map(([val, label, color]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className={`text-2xl font-bold ${color}`}>{val}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500">
        Measured from approved flats only; a locality needs {MIN_SAMPLE}+ of each kind to show a figure.
        {priced.length < rows.length ? ` ${rows.length - priced.length} of ${rows.length} localities have too few flats to price.` : ''}
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Asking ₹/sqft by locality" desc="Priced localities only." height={340}>
          <BarChart horizontal labels={priced.map((l) => l.name)} datasets={[{ label: 'Asking rate', data: priced.map((l) => l.avgActualRatePerSqft), color: C.teal }]} options={{ scales: { x: axis({ ticks: { callback: (v) => `₹${(v / 1000).toFixed(0)}k` } }), y: AX } }} />
        </Card>
        <Card title="Rental yield by locality" desc="Annual rent / property value %" height={340}>
          <BarChart horizontal labels={yieldRanking.map((l) => l.name)} datasets={[{ label: 'Yield %', data: yieldRanking.map((l) => l.rentalYieldPct), color: C.emerald }]} options={{ scales: { x: axis({ ticks: { callback: (v) => `${v}%` } }), y: AX } }} />
        </Card>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Locality Pricing Breakdown</h3>
        {/* A scrollable region is the documented exception to the no-tabIndex rule: without it the right-hand columns are mouse-only. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- named scroll region, see above */}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Locality pricing breakdown">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-white/10"><th scope="col" className="text-left py-2 font-medium">Locality</th><th scope="col" className="text-right py-2 font-medium">Asking ₹/sqft</th><th scope="col" className="text-right py-2 font-medium">Avg rent</th><th scope="col" className="text-right py-2 font-medium">Yield %</th><th scope="col" className="text-right py-2 font-medium">Buy</th><th scope="col" className="text-right py-2 font-medium">Rent</th><th scope="col" className="text-right py-2 font-medium">Total</th></tr></thead>
            <tbody>
              {[...rows].sort((a, b) => b.totalListings - a.totalListings).map((l) => (
                <tr key={l.slug} className="border-b border-white/5">
                  <td className="py-2.5 text-white font-medium">{l.name}</td>
                  <td className="py-2.5 text-right tabular-nums text-teal-300">{money(l.avgActualRatePerSqft)}</td>
                  <td className="py-2.5 text-right tabular-nums text-teal-300">{money(l.avgRent)}</td>
                  <td className={classNames('py-2.5 text-right tabular-nums font-semibold', l.rentalYieldPct == null ? 'text-gray-500' : l.rentalYieldPct >= 4 ? 'text-emerald-300' : l.rentalYieldPct >= 3 ? 'text-amber-300' : 'text-gray-400')}>{pct(l.rentalYieldPct)}</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-400">{fmtNum(l.buyCount)}</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-400">{fmtNum(l.rentCount)}</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-300">{fmtNum(l.totalListings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
