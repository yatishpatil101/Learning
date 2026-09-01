import { useMemo } from 'react';
import { classNames } from '../../../lib/format.js';

/**
 * What to print in the locality column.
 *
 * Three cases, and none of them may silently look like the others. A resolved name is printed as
 * itself. A slug with no matching locality prints the slug, because "somebody asked for a place we
 * do not cover" is the most actionable row here and hiding it behind a dash would delete the
 * finding. And the one row with no slug at all is named out loud, because a blank there reads as a
 * rendering bug rather than as "they did not tell us where".
 */
const rowLabel = (r) => {
  if (r.localitySlug == null) return 'No locality given';
  return r.localityName || r.localitySlug;
};

/** Stable across renders and unique per row, including the single null-slug row. */
const rowKey = (r) => r.localitySlug ?? '__unplaced__';

/**
 * When the most recent ask for a city arrived.
 *
 * Date only. The hour somebody typed "Nashik" is not a fact anybody acts on, and printing it would
 * imply a precision the decision does not have.
 */
const askedOn = (iso) => {
  /* `new Date(null)` is a *valid* Date at the epoch, so the NaN guard below does not catch it and
     a missing timestamp would print a confident "1 Jan 1970". */
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '\u2014'
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * Rows come from `demandService.supplyGap()`, i.e. `GET /admin/supply-gap`.
 *
 * Two things on this tab used to be assembled here and are not any more. The demand columns were
 * read out of localStorage, so they described the searches performed by whoever was reading the
 * report; and the "Demand Alerts by Locality" panel called `alertsByLocality()` against the same
 * storage. Both now come from the one server aggregate, which is why the alerts panel below has
 * lost its deal split, its "last requested" date and its property-type label: none of those exist
 * server-side, because the demand table stores counts and nothing else.
 *
 * `localitySlug` is null on exactly one row -- the signals that named no locality at all -- and
 * `localityName` is absent when the slug matches no known locality, which is somebody asking for
 * somewhere PuneNest does not cover. Both are labelled rather than hidden.
 *
 * The third panel, "City Expansion Requests", asks a different question from the two above it: they
 * are about localities inside a city PuneNest already serves, and it is about cities it does not.
 * It used to aggregate a `pnCityRequests` array in localStorage, so it could only ever show asks
 * made from the reading operator's own browser -- on every real console it rendered its empty state
 * while the asks piled up elsewhere. It reads `GET /admin/cities/waitlist` now.
 *
 * `cityWaitlist` is three-valued on purpose -- `null` before it arrives, and `failed` separately --
 * because an empty array here renders "no city requests yet", and that sentence manufactured out of
 * a 500 is precisely the failure this panel was rebuilt to stop making.
 */
export default function SupplyGapTab({ supplyGap, cityWaitlist, cityWaitlistFailed, onRetryCityWaitlist }) {
  const underServed = supplyGap.filter((r) => r.gap > 0);
  const wellServed = supplyGap.filter((r) => r.gap <= 0);
  const totalHot = supplyGap.reduce((s, r) => s + (r.repeatSeekers || 0), 0);
  const totalViews = supplyGap.reduce((s, r) => s + (r.views || 0), 0);
  const maxDemand = Math.max(...supplyGap.map((r) => r.demand), 1);
  const maxSupply = Math.max(...supplyGap.map((r) => r.supply), 1);
  const localityAlerts = useMemo(
    () => supplyGap.filter((r) => r.alerts > 0).sort((a, b) => b.alerts - a.alerts),
    [supplyGap],
  );
  const totalLocalityAlerts = localityAlerts.reduce((s, a) => s + a.alerts, 0);
  const maxAlertCount = Math.max(...localityAlerts.map((a) => a.alerts), 1);
  // Server-ordered (most requested first) -- not re-sorted here, so the console cannot disagree
  // with the report about which city is top.
  const cityRows = cityWaitlist || [];
  const totalCityRequests = cityRows.reduce((s, c) => s + c.requests, 0);
  const maxCityRequests = Math.max(...cityRows.map((c) => c.requests), 1);

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
            <div key={rowKey(r)} className="flex items-center gap-3">
              <span className="text-xs text-gray-300 w-28 shrink-0 truncate font-medium">{rowLabel(r)}</span>
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
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-indigo-500/60" /> Demand (weighted: alert 5, search 2, view 1)</span>
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
                <tr key={rowKey(r)} className="border-b border-white/5">
                  <td className="py-2.5 text-white font-medium">{rowLabel(r)}</td>
                  <td className="py-2.5 text-right tabular-nums text-teal-300">{r.supply}</td>
                  <td className="py-2.5 text-right tabular-nums text-indigo-300">{r.demand}</td>
                  <td className="py-2.5 text-right tabular-nums text-amber-300">{r.searches || '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-sky-300">{r.views || '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-purple-300">{r.alerts || '—'}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.repeatSeekers ? <span className="text-rose-300 font-semibold">{r.repeatSeekers}</span> : '—'}</td>
                  <td className={classNames('py-2.5 text-right tabular-nums font-semibold', r.gap > 0 ? 'text-rose-300' : 'text-emerald-300')}>{r.gap > 0 ? '+' : ''}{r.gap}</td>
                  <td className="py-2.5 text-center">
                    {r.gap >= 5 || r.repeatSeekers >= 2 ? <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">High</span>
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
                <div key={rowKey(a)} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate">
                    <span className="text-xs text-gray-300 font-medium">{rowLabel(a)}</span>
                  </span>
                  <div className="flex-1 relative h-6 rounded bg-white/5 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-amber-500/60 flex items-center pl-2"
                      style={{ width: `${Math.max((a.alerts / maxAlertCount) * 100, 12)}%` }}
                    >
                      <span className="text-[11px] font-bold text-white">{a.alerts}</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-gray-500 w-32 text-right tabular-nums">
                    {a.supply} listed
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 text-[11px] text-gray-500 border-t border-white/5 pt-3">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500/60" /> Alert count</span>
              <span>Current supply shown on right</span>
              {localityAlerts[0] && <span className="ml-auto text-amber-300 font-semibold">Top: {rowLabel(localityAlerts[0])} ({localityAlerts[0].alerts})</span>}
            </div>
          </>
        )}
      </div>

      {/* City Expansion Requests — where people want PuneNest to launch next (GET /admin/cities/waitlist) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-300">City Expansion Requests</h3>
          {cityWaitlist && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-400">
              {totalCityRequests} request{totalCityRequests !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-4">People who asked to be told when PuneNest launches in a city it does not serve yet. Counts only — the waitlist holds contact details and this report deliberately does not carry them.</p>

        {cityWaitlistFailed ? (
          <div role="alert" className="text-center py-8 text-sm text-amber-300">
            Couldn&apos;t load city requests. This is a failed read, not an empty waitlist — don&apos;t read it as &ldquo;nobody asked&rdquo;.
            <div className="mt-3">
              <button type="button" onClick={onRetryCityWaitlist} className="rounded-lg border border-amber-300/30 px-3 py-1 text-xs text-amber-200 hover:bg-amber-300/10">
                Try again
              </button>
            </div>
          </div>
        ) : !cityWaitlist ? (
          <div role="status" className="text-center py-8 text-gray-500 text-sm">Loading city requests…</div>
        ) : cityRows.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            <div aria-hidden="true" className="text-3xl mb-2">🗺️</div>
            No city requests yet. These appear when a visitor picks a city PuneNest hasn&apos;t launched in and joins its waitlist.
          </div>
        ) : (
          <>
            <div className="space-y-2 mb-4">
              {cityRows.map((c) => (
                <div key={c.city.toLowerCase()} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate">
                    <span className="text-xs text-gray-300 font-medium">{c.city}</span>
                  </span>
                  <div className="flex-1 relative h-6 rounded bg-white/5 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-sky-500/60 flex items-center pl-2"
                      style={{ width: `${Math.max((c.requests / maxCityRequests) * 100, 12)}%` }}
                    >
                      <span className="text-[11px] font-bold text-white">{c.requests}</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-gray-500 w-32 text-right tabular-nums">
                    last {askedOn(c.lastRequestedAt)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 text-[11px] text-gray-500 border-t border-white/5 pt-3">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-sky-500/60" /> People asking</span>
              <span>Most recent ask shown on right</span>
              <span className="ml-auto text-sky-300 font-semibold">Top: {cityRows[0].city} ({cityRows[0].requests})</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
