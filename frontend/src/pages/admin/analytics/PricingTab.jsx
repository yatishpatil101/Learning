import { BarChart } from '../../../components/charts/index.jsx';
import { fmtINR, fmtNum, classNames } from '../../../lib/format.js';
import { C, AX, axis, Card, LoadFailedNotice } from './constants.jsx';

/**
 * How far from the curated market rate still counts as fairly priced.
 *
 * Ten per cent either way. This is a judgement rather than a measurement, which is why it is named
 * and sits here instead of inline in three comparisons: a reader who disagrees with it can see that
 * it was chosen, and change it in one place.
 */
const FAIR_BAND_PCT = 10;

/** Must match `AdminPricingService.MIN_SAMPLE`: fewer approved flats than this get no asking rate. */
const MIN_SAMPLE = 3;

/** Nullable money. A dash, never a zero — the point of the endpoint is that it can say "no data". */
const money = (v) => (v == null ? '—' : fmtINR(v));

/** Nullable percentage, same contract. */
const pct = (v) => (v == null ? '—' : `${v}%`);

/** Asking rate's deviation from the curated market rate, or null when either half is missing. */
const deviation = (row) =>
  (row.avgActualRatePerSqft == null || !row.marketRatePerSqft
    ? null
    : ((row.avgActualRatePerSqft - row.marketRatePerSqft) / row.marketRatePerSqft) * 100);

/** Nulls render as dashes, never coerced: a market-rate fallback would score a thin locality as fair. */
export default function PricingTab({ rows, failed }) {
  if (failed) {
    return (
      <LoadFailedNotice>
        The pricing endpoint did not answer, so no locality figures are shown. They are deliberately
        left blank rather than defaulted — an empty report here reads as “nothing is mispriced”.
      </LoadFailedNotice>
    );
  }
  if (!rows) return null;

  const measured = rows.filter((r) => deviation(r) != null);
  const overpriced = measured.filter((r) => deviation(r) > FAIR_BAND_PCT).length;
  const underpriced = measured.filter((r) => deviation(r) < -FAIR_BAND_PCT).length;
  const fair = measured.length - overpriced - underpriced;

  const yields = rows.map((r) => r.rentalYieldPct).filter((y) => y != null);
  const avgYield = yields.length
    ? Math.round((yields.reduce((s, y) => s + y, 0) / yields.length) * 10) / 10
    : null;

  const marketRates = rows.map((r) => r.marketRatePerSqft).filter((v) => v != null);
  const yieldRanking = rows
    .filter((r) => r.rentalYieldPct != null)
    .sort((a, b) => b.rentalYieldPct - a.rentalYieldPct);

  return (
    <div className="space-y-6">
      {/* KPI summary — per locality, because that is the granularity the server measures at. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        {[
          [fmtNum(measured.length), 'Localities priced', 'text-white'],
          [fair, `Fair priced (±${FAIR_BAND_PCT}%)`, 'text-emerald-400'],
          [overpriced, 'Overpriced areas', 'text-rose-400'],
          [underpriced, 'Underpriced areas', 'text-amber-400'],
          [pct(avgYield), 'Avg rental yield', 'text-teal-400'],
          [money(marketRates.length ? Math.max(...marketRates) : null), 'Highest market rate', 'text-indigo-400'],
          [money(marketRates.length ? Math.min(...marketRates) : null), 'Lowest market rate', 'text-sky-400'],
        ].map(([val, label, color]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className={`text-2xl font-bold ${color}`}>{val}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500">
        Asking rate and yield are measured from approved flats only, and need {MIN_SAMPLE}+ per locality.
        Market rate, avg rent and demand are curated reference figures.
        {measured.length < rows.length ? ` ${rows.length - measured.length} of ${rows.length} localities have too few flats to price.` : ''}
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Market rate vs asking ₹/sqft" desc="Priced localities only." height={340}>
          <BarChart labels={measured.map((l) => l.name)} datasets={[{ label: 'Market rate', data: measured.map((l) => l.marketRatePerSqft), color: C.indigo }, { label: 'Asking rate', data: measured.map((l) => l.avgActualRatePerSqft), color: C.teal }]} options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8', callback: (v) => `₹${(v / 1000).toFixed(0)}k` } }) } }} />
        </Card>
        <Card title="Rental yield by locality" desc="Annual rent / property value %" height={340}>
          <BarChart horizontal labels={yieldRanking.map((l) => l.name)} datasets={[{ label: 'Yield %', data: yieldRanking.map((l) => l.rentalYieldPct), color: C.emerald }]} options={{ scales: { x: axis({ ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }), y: AX } }} />
        </Card>
      </div>

      {/* Locality pricing breakdown — measured. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Locality Pricing Breakdown</h3>
        {/* Focusable so a keyboard-only user can reach the right-hand columns (WCAG 2.1.1). The rule
            fires on any non-interactive tabIndex, but a scrollable region is the documented
            exception — without it the Demand and Opportunity columns are mouse-only. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- named scroll region, see above */}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Locality pricing breakdown">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-white/10"><th scope="col" className="text-left py-2 font-medium">Locality</th><th scope="col" className="text-right py-2 font-medium">Market ₹/sqft</th><th scope="col" className="text-right py-2 font-medium">Asking ₹/sqft</th><th scope="col" className="text-right py-2 font-medium">Avg rent</th><th scope="col" className="text-right py-2 font-medium">Yield %</th><th scope="col" className="text-right py-2 font-medium">Buy</th><th scope="col" className="text-right py-2 font-medium">Rent</th><th scope="col" className="text-right py-2 font-medium">Demand</th><th scope="col" className="text-center py-2 font-medium">Opportunity</th></tr></thead>
            <tbody>
              {[...rows].sort((a, b) => (b.demand ?? 0) - (a.demand ?? 0)).map((l) => (
                <tr key={l.slug} className="border-b border-white/5">
                  <td className="py-2.5 text-white font-medium">{l.name}</td>
                  <td className="py-2.5 text-right tabular-nums text-indigo-300">{money(l.marketRatePerSqft)}</td>
                  <td className="py-2.5 text-right tabular-nums text-teal-300">{money(l.avgActualRatePerSqft)}</td>
                  <td className="py-2.5 text-right tabular-nums text-teal-300">{money(l.avgRent)}</td>
                  <td className={classNames('py-2.5 text-right tabular-nums font-semibold', l.rentalYieldPct == null ? 'text-gray-500' : l.rentalYieldPct >= 4 ? 'text-emerald-300' : l.rentalYieldPct >= 3 ? 'text-amber-300' : 'text-gray-400')}>{pct(l.rentalYieldPct)}</td>
                  {/* Real counts, so 0 is printed as 0. `|| '—'` here would collapse "we have
                      nothing in this locality" — the single most actionable finding on the tab —
                      into the same glyph used for "not measured" one column to the left. */}
                  <td className="py-2.5 text-right tabular-nums text-gray-400">{fmtNum(l.buyCount)}</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-400">{fmtNum(l.rentCount)}</td>
                  <td className="py-2.5 text-right tabular-nums text-sky-300">{l.demand ?? '—'}</td>
                  <td className="py-2.5 text-center">
                    {/* Demand is curated and nullable. Reading a missing value as 0 would fall
                        through to "Stable" — a positive operational verdict manufactured from an
                        absent measurement, in the row whose Demand cell already prints a dash. */}
                    {l.demand == null ? <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-gray-500">Not measured</span>
                    : l.demand >= 85 && l.totalListings <= 2 ? <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">High opportunity</span>
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
