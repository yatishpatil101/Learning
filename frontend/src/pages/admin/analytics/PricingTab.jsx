import { Link } from 'react-router';
import { BarChart, LineChart } from '../../../components/charts/index.jsx';
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

/** Nullable money. A dash, never a zero — the point of the endpoint is that it can say "no data". */
const money = (v) => (v == null ? '—' : fmtINR(v));

/** Nullable percentage, same contract. */
const pct = (v) => (v == null ? '—' : `${v}%`);

/** Asking rate's deviation from the curated market rate, or null when either half is missing. */
const deviation = (row) =>
  (row.avgActualRatePerSqft == null || !row.marketRatePerSqft
    ? null
    : ((row.avgActualRatePerSqft - row.marketRatePerSqft) / row.marketRatePerSqft) * 100);

/**
 * The Pricing tab: measured locality pricing, plus two illustrative cards.
 *
 * `rows` is the server report (`GET /admin/analytics/pricing`) and every figure derived from it is
 * real. `sample` is the seeded generator and feeds only the two cards the platform stores no data
 * for — the six-month price trend, which would need price-history snapshots nobody records, and the
 * per-listing price position table, which is a granularity the server does not report at. Both
 * carry a `Sample` chip.
 *
 * **Nulls render as dashes and are never coerced.** A locality with no approved buy listings has no
 * average asking rate. The browser version filled that hole with the curated market rate, so an
 * empty locality showed a deviation of exactly zero and counted towards "fair priced" — the report
 * flattered precisely the areas with nothing in them. Every dash here is somewhere worth sourcing.
 *
 * @param {{rows: (object[]|null), sample: (object|null), failed: boolean}} props `rows` of null
 *   means "not loaded yet" and renders nothing; an empty array means the report loaded and is empty,
 *   which renders. `failed` separates the two — without it a 500 would render as a successful report
 *   finding no mispriced localities anywhere, which is the most misleading page this tab can show.
 */
export default function PricingTab({ rows, sample, failed }) {
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
  // Summed over `measured`, not `rows`. The four tiles beside this one are computed over the
  // localities an asking rate could actually be derived for, and a headline that counted the rest
  // would overstate the sample the analysis rests on — on the one tab whose purpose is not doing that.
  const analysedListings = measured.reduce((s, r) => s + r.totalListings, 0);
  const yieldRanking = rows
    .filter((r) => r.rentalYieldPct != null)
    .sort((a, b) => b.rentalYieldPct - a.rentalYieldPct);

  return (
    <div className="space-y-6">
      {/* KPI summary — per locality, because that is the granularity the server measures at. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        {[
          [fmtNum(analysedListings), 'Listings analysed', 'text-white'],
          [fair, `Fair priced (±${FAIR_BAND_PCT}%)`, 'text-emerald-400'],
          [overpriced, 'Overpriced areas', 'text-rose-400'],
          [underpriced, 'Underpriced areas', 'text-amber-400'],
          [pct(avgYield), 'Avg rental yield', 'text-teal-400'],
          [money(marketRates.length ? Math.max(...marketRates) : null), 'Highest ₹/sqft', 'text-indigo-400'],
          [money(marketRates.length ? Math.min(...marketRates) : null), 'Lowest ₹/sqft', 'text-sky-400'],
        ].map(([val, label, color]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className={`text-2xl font-bold ${color}`}>{val}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {measured.length < rows.length ? (
        <p className="text-xs text-gray-500">
          {rows.length - measured.length} of {rows.length} localities have no approved listing with a
          usable area, so no asking rate could be measured. They show a dash rather than being assumed
          to match the market rate.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Market rate vs actual ₹/sqft" desc="Per locality. Gaps are localities with nothing to average." height={340}>
          <BarChart labels={rows.map((l) => l.name)} datasets={[{ label: 'Market rate', data: rows.map((l) => l.marketRatePerSqft), color: C.indigo }, { label: 'Actual rate', data: rows.map((l) => l.avgActualRatePerSqft), color: C.teal }]} options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8', callback: (v) => `₹${(v / 1000).toFixed(0)}k` } }) } }} />
        </Card>
        <Card title="Rental yield by locality" desc="Annual rent / property value %" height={340}>
          <BarChart horizontal labels={yieldRanking.map((l) => l.name)} datasets={[{ label: 'Yield %', data: yieldRanking.map((l) => l.rentalYieldPct), color: C.emerald }]} options={{ scales: { x: axis({ ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }), y: AX } }} />
        </Card>
      </div>

      {/* Illustrative: PuneNest records no price history, so a trend cannot be derived from it. */}
      {sample ? (
        <Card title="Price trend — ₹/sqft (6 months)" desc="Top 8 localities" chip="Sample" height={300}>
          <LineChart labels={sample.priceTrends[0]?.trend.map((t) => t.month) || []} datasets={sample.priceTrends.map((loc, i) => ({ label: loc.name, data: loc.trend.map((t) => t.rate), color: [C.teal, C.indigo, C.coral, C.emerald, C.amber, C.rose, C.violet, C.slate][i], fill: false }))} options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8', callback: (v) => `₹${(v / 1000).toFixed(1)}k` } }) } }} />
        </Card>
      ) : null}

      {/* Illustrative: the server reports per locality, not per listing. */}
      {sample ? (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-300">Listing Price Position</h3>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-400" title="Illustrative sample data">Sample</span>
        </div>
        <p className="text-xs text-gray-500 mb-4">How each listing is priced relative to market.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-white/10"><th className="text-left py-2 font-medium">Listing</th><th className="text-left py-2 font-medium">Locality</th><th className="text-center py-2 font-medium">Deal</th><th className="text-right py-2 font-medium">Price</th><th className="text-right py-2 font-medium">Market est.</th><th className="text-right py-2 font-medium">Deviation</th><th className="text-right py-2 font-medium">Views</th><th className="text-center py-2 font-medium">Status</th></tr></thead>
            <tbody>
              {[...sample.pricePositions].sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation)).slice(0, 20).map((p) => (
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
      ) : null}

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
