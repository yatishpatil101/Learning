import { useMemo } from 'react';
import { classNames } from '../../../lib/format.js';
import { alertsByLocality } from '../../../lib/data/analytics-extra.js';

function useCityRequests() {
  return useMemo(() => {
    let raw = [];
    try { raw = JSON.parse(localStorage.getItem('pnCityRequests')) || []; } catch { /* empty */ }
    // Aggregate by city name, count requests, track last request time
    const map = {};
    raw.forEach((r) => {
      const city = (r.city || '').trim();
      if (!city) return;
      if (!map[city]) map[city] = { city, count: 0, lastAt: 0 };
      map[city].count += 1;
      if (r.at > map[city].lastAt) map[city].lastAt = r.at;
    });
    // Sort by count descending (most requested on top)
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, []);
}

export default function SupplyGapTab({ supplyGap }) {
  const underServed = supplyGap.filter((r) => r.gap > 0);
  const wellServed = supplyGap.filter((r) => r.gap <= 0);
  const totalHot = supplyGap.reduce((s, r) => s + (r.hot || 0), 0);
  const totalViews = supplyGap.reduce((s, r) => s + (r.views || 0), 0);
  const maxDemand = Math.max(...supplyGap.map((r) => r.demand), 1);
  const maxSupply = Math.max(...supplyGap.map((r) => r.supply), 1);
  const cityRequests = useCityRequests();
  const localityAlerts = useMemo(() => alertsByLocality(), []);
  const totalLocalityAlerts = localityAlerts.reduce((s, a) => s + a.count, 0);
  const maxAlertCount = Math.max(...localityAlerts.map((a) => a.count), 1);
  const totalCityRequests = cityRequests.reduce((s, c) => s + c.count, 0);
  const topRequested = cityRequests[0];
  const maxCount = topRequested?.count || 1;

  return (
    <div className="space-y-6">
      {/* KPI summary */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><div className="text-2xl font-bold text-rose-400">{underServed.length}</div><div className="text-xs text-gray-500 mt-0.5">Under-served</div></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><div className="text-2xl font-bold text-emerald-400">{wellServed.length}</div><div className="text-xs text-gray-500 mt-0.5">Well-served</div></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><div className="text-2xl font-bold text-amber-400">{supplyGap.reduce((s, r) => s + r.demand, 0)}</div><div className="text-xs text-gray-500 mt-0.5">Total demand</div></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><div className="text-2xl font-bold text-teal-400">{supplyGap.reduce((s, r) => s + r.supply, 0)}</div><div className="text-xs text-gray-500 mt-0.5">Total supply</div></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><div className="text-2xl font-bold text-sky-400">{totalViews}</div><div className="text-xs text-gray-500 mt-0.5">Property views (30d)</div></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><div className="text-2xl font-bold text-rose-400">{totalHot}</div><div className="text-xs text-gray-500 mt-0.5">Hot demand users</div></div>
      </div>

      {/* Visual gap chart */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Supply vs Demand by Locality</h3>
        <p className="text-xs text-gray-500 mb-4">Red gap = under-served. Green = well-served.</p>
        <div className="space-y-2.5">
          {supplyGap.slice(0, 12).map((r) => (
            <div key={r.name} className="flex items-center gap-3">
              <span className="text-xs text-gray-300 w-28 shrink-0 truncate font-medium">{r.name}</span>
              <div className="flex-1 flex items-center gap-1 h-5">
                <div className="flex-1 relative h-full rounded bg-white/5 overflow-hidden"><div className="absolute inset-y-0 left-0 rounded bg-teal-500/60" style={{ width: `${(r.supply / maxSupply) * 100}%` }} /></div>
                <div className="flex-1 relative h-full rounded bg-white/5 overflow-hidden"><div className="absolute inset-y-0 left-0 rounded bg-indigo-500/60" style={{ width: `${(r.demand / maxDemand) * 100}%` }} /></div>
              </div>
              <span className={classNames('text-xs font-semibold tabular-nums w-12 text-right', r.gap > 0 ? 'text-rose-300' : 'text-emerald-300')}>{r.gap > 0 ? '+' : ''}{r.gap}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-4 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-teal-500/60" /> Supply (listings)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-indigo-500/60" /> Demand (enquiries)</span>
        </div>
      </div>

      {/* Full table */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">All Localities — Detailed Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-white/10">
                <th className="text-left py-2 font-medium">Locality</th>
                <th className="text-right py-2 font-medium">Supply</th>
                <th className="text-right py-2 font-medium">Demand</th>
                <th className="text-right py-2 font-medium">Searches</th>
                <th className="text-right py-2 font-medium">Views</th>
                <th className="text-right py-2 font-medium">Alerts</th>
                <th className="text-right py-2 font-medium">Hot</th>
                <th className="text-right py-2 font-medium">Gap</th>
                <th className="text-center py-2 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {supplyGap.map((r) => (
                <tr key={r.name} className="border-b border-white/5">
                  <td className="py-2.5 text-white font-medium">{r.name}</td>
                  <td className="py-2.5 text-right tabular-nums text-teal-300">{r.supply}</td>
                  <td className="py-2.5 text-right tabular-nums text-indigo-300">{r.demand}</td>
                  <td className="py-2.5 text-right tabular-nums text-amber-300">{r.searches || '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-sky-300">{r.views || '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-purple-300">{r.alerts || '—'}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.hot ? <span className="text-rose-300 font-semibold">{r.hot}</span> : '—'}</td>
                  <td className={classNames('py-2.5 text-right tabular-nums font-semibold', r.gap > 0 ? 'text-rose-300' : 'text-emerald-300')}>{r.gap > 0 ? '+' : ''}{r.gap}</td>
                  <td className="py-2.5 text-center">
                    {r.gap >= 5 || r.hot >= 2 ? <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">High</span>
                    : r.gap > 0 ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">Medium</span>
                    : <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">OK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Demand Alerts by Locality — "wanted here" signal from listings alerts */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-300">Demand Alerts by Locality</h3>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-400">
            {totalLocalityAlerts} alert{totalLocalityAlerts !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-4">Users who created a "notify me" alert when a locality had no/few matches — the clearest signal of where to source supply next.</p>

        {localityAlerts.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            <div className="text-3xl mb-2">🔔</div>
            No demand alerts yet. Alerts appear here when users tap "Create alert" on an empty search.
          </div>
        ) : (
          <>
            <div className="space-y-2 mb-4">
              {localityAlerts.map((a) => (
                <div key={a.locality} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate">
                    <span className="text-xs text-gray-300 font-medium">{a.locality}</span>
                    {a.topType && <span className="block text-[10px] text-amber-300/70 truncate">{a.topType}</span>}
                  </span>
                  <div className="flex-1 relative h-6 rounded bg-white/5 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-amber-500/60 flex items-center pl-2"
                      style={{ width: `${Math.max((a.count / maxAlertCount) * 100, 12)}%` }}
                    >
                      <span className="text-[11px] font-bold text-white">{a.count}</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-gray-500 w-32 text-right tabular-nums">
                    {a.rent ? `${a.rent} rent` : ''}{a.rent && a.buy ? ' · ' : ''}{a.buy ? `${a.buy} buy` : ''}
                  </span>
                  <span className="text-[11px] text-gray-500 w-20 text-right tabular-nums">
                    {a.lastAt ? new Date(a.lastAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 text-[11px] text-gray-500 border-t border-white/5 pt-3">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500/60" /> Alert count</span>
              <span>Deal split &amp; last request shown on right</span>
              {localityAlerts[0] && <span className="ml-auto text-amber-300 font-semibold">Top: {localityAlerts[0].locality} ({localityAlerts[0].count})</span>}
            </div>
          </>
        )}
      </div>

      {/* City Requests — "Request Your City" demand signal */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-300">City Expansion Requests</h3>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-400">
            {totalCityRequests} total request{totalCityRequests !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-4">Users who submitted "Request your city" — sorted by most requested. Signals unserved demand for geographic expansion.</p>

        {cityRequests.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            <div className="text-3xl mb-2">📍</div>
            No city requests yet. Requests appear here when users use "Request your city" from the navbar.
          </div>
        ) : (
          <>
            {/* Bar visualization */}
            <div className="space-y-2 mb-4">
              {cityRequests.map((c) => (
                <div key={c.city} className="flex items-center gap-3">
                  <span className="text-xs text-gray-300 w-28 shrink-0 truncate font-medium">{c.city}</span>
                  <div className="flex-1 relative h-6 rounded bg-white/5 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-teal-500/60 flex items-center pl-2"
                      style={{ width: `${Math.max((c.count / maxCount) * 100, 12)}%` }}
                    >
                      <span className="text-[11px] font-bold text-white">{c.count}</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-gray-500 w-24 text-right tabular-nums">
                    {c.lastAt ? new Date(c.lastAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                  </span>
                </div>
              ))}
            </div>

            {/* Summary row */}
            <div className="flex items-center gap-4 text-[11px] text-gray-500 border-t border-white/5 pt-3">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-teal-500/60" /> Request count</span>
              <span>Last requested date shown on right</span>
              {topRequested && <span className="ml-auto text-teal-300 font-semibold">Top: {topRequested.city} ({topRequested.count})</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
