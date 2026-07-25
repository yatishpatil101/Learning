import { useState } from 'react';
import { ArrowDown, TrendingUp } from 'lucide-react';
import { fmtINR, fmtNum, classNames } from '../../../lib/format.js';
import DateRangePills from '../../../components/ui/DateRangePills.jsx';
import DealPills from '../../../components/ui/DealPills.jsx';

function FunnelView({ enquiries, visits, deals, funnelTime, setFunnelTime }) {
  const [funnelDeal, setFunnelDeal] = useState('');

  const cutoff = funnelTime ? Date.now() - Number(funnelTime) * 86400000 : 0;
  const inRange = (dateStr) => !cutoff || new Date(dateStr).getTime() >= cutoff;
  const matchDeal = (item) => !funnelDeal || item.deal === funnelDeal || (item.kind === funnelDeal);

  const enqCount = enquiries.filter((e) => inRange(e.at) && matchDeal(e)).length;
  const visitCount = visits.filter((v) => inRange(v.when) && matchDeal(v)).length;
  const dealsCompleted = deals.filter((d) => d.status === 'closed' && inRange(d.at) && matchDeal(d));
  const dealCount = dealsCompleted.length;
  const dealGMV = dealsCompleted.reduce((sum, d) => sum + (d.value || 0), 0);

  const enqToVisit = enqCount > 0 ? Math.round((visitCount / enqCount) * 100) : 0;
  const visitToDeal = visitCount > 0 ? Math.round((dealCount / visitCount) * 100) : 0;
  const enqToDeal = enqCount > 0 ? Math.round((dealCount / enqCount) * 100) : 0;

  // Locality breakdown
  const localityMap = {};
  enquiries.filter((e) => inRange(e.at) && matchDeal(e)).forEach((e) => {
    const loc = (e.listing || '').split(' in ')[1] || 'Unknown';
    if (!localityMap[loc]) localityMap[loc] = { locality: loc, enquiries: 0, visits: 0, deals: 0, gmv: 0 };
    localityMap[loc].enquiries++;
  });
  visits.filter((v) => inRange(v.when) && matchDeal(v)).forEach((v) => {
    const loc = (v.listing || '').split(' in ')[1] || 'Unknown';
    if (!localityMap[loc]) localityMap[loc] = { locality: loc, enquiries: 0, visits: 0, deals: 0, gmv: 0 };
    localityMap[loc].visits++;
  });
  dealsCompleted.forEach((d) => {
    const loc = (d.listing || '').split(' in ')[1] || 'Unknown';
    if (!localityMap[loc]) localityMap[loc] = { locality: loc, enquiries: 0, visits: 0, deals: 0, gmv: 0 };
    localityMap[loc].deals++;
    localityMap[loc].gmv += d.value || 0;
  });
  const localityRows = Object.values(localityMap).sort((a, b) => b.enquiries - a.enquiries).slice(0, 10);

  const stages = [
    { label: 'Enquiries', count: enqCount, pct: 100, color: 'bg-indigo-500' },
    { label: 'Site Visits', count: visitCount, pct: enqToVisit, color: 'bg-teal-500' },
    { label: 'Deals Closed', count: dealCount, pct: visitToDeal, color: 'bg-emerald-500' },
  ];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <DealPills value={funnelDeal} onChange={setFunnelDeal} />
        <DateRangePills value={funnelTime} onChange={setFunnelTime} />
        <span className="text-xs text-gray-500 ml-auto">Conversion funnel: Enquiry → Visit → Deal</span>
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-2xl font-bold text-indigo-400">{fmtNum(enqCount)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total Enquiries</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-2xl font-bold text-teal-400">{fmtNum(visitCount)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Site Visits</div>
          <div className="text-[11px] text-teal-300 mt-1">{enqToVisit}% of enquiries</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-2xl font-bold text-emerald-400">{fmtNum(dealCount)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Deals Closed</div>
          <div className="text-[11px] text-emerald-300 mt-1">{visitToDeal}% of visits</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="text-2xl font-bold text-amber-400">{fmtINR(dealGMV)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Deal GMV</div>
          <div className="text-[11px] text-amber-300 mt-1">{enqToDeal}% overall conversion</div>
        </div>
      </div>

      {/* Visual funnel */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-teal-400" /> Conversion Funnel
        </h3>
        <div className="space-y-3">
          {stages.map((s, i) => (
            <div key={s.label}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-white font-medium">{s.label}</span>
                <span className="text-sm tabular-nums text-gray-300">{fmtNum(s.count)} <span className="text-gray-500 text-xs">({s.pct}%)</span></span>
              </div>
              <div className="h-8 rounded-lg bg-white/5 overflow-hidden">
                <div
                  className={classNames('h-full rounded-lg transition-all flex items-center px-3', s.color)}
                  style={{ width: `${Math.max(enqCount > 0 ? (s.count / enqCount) * 100 : 0, 4)}%` }}
                >
                  {s.count > 0 && <span className="text-[11px] font-bold text-white">{fmtNum(s.count)}</span>}
                </div>
              </div>
              {i < stages.length - 1 && (
                <div className="flex justify-center py-1">
                  <ArrowDown className="h-4 w-4 text-gray-600" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Platform-wide conversion rates */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-400" /> Platform-wide Conversion Rates
        </h3>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <div className="pn-card p-4">
            <div className="text-2xl font-bold text-teal-400">{enqToVisit}%</div>
            <div className="text-xs text-gray-500 mt-0.5">Enquiry → Visit</div>
            <div className="text-[11px] text-gray-400 mt-1">{fmtNum(visitCount)} of {fmtNum(enqCount)} enquiries</div>
          </div>
          <div className="pn-card p-4">
            <div className="text-2xl font-bold text-emerald-400">{visitToDeal}%</div>
            <div className="text-xs text-gray-500 mt-0.5">Visit → Deal</div>
            <div className="text-[11px] text-gray-400 mt-1">{fmtNum(dealCount)} of {fmtNum(visitCount)} visits</div>
          </div>
          <div className="pn-card p-4">
            <div className="text-2xl font-bold text-indigo-400">{enqToDeal}%</div>
            <div className="text-xs text-gray-500 mt-0.5">Overall: Enquiry → Deal</div>
            <div className="text-[11px] text-gray-400 mt-1">{fmtNum(dealCount)} of {fmtNum(enqCount)} enquiries</div>
          </div>
          <div className="pn-card p-4">
            <div className="text-2xl font-bold text-amber-400">{enqCount > 0 ? fmtINR(Math.round(dealGMV / enqCount)) : '₹0'}</div>
            <div className="text-xs text-gray-500 mt-0.5">Revenue per Enquiry</div>
            <div className="text-[11px] text-gray-400 mt-1">GMV {fmtINR(dealGMV)} / {fmtNum(enqCount)} enq</div>
          </div>
        </div>
      </div>

      {/* Locality breakdown */}
      {localityRows.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Breakdown by Locality</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-white/10">
                  <th className="text-left py-2 font-medium">Locality</th>
                  <th className="text-right py-2 font-medium">Enquiries</th>
                  <th className="text-right py-2 font-medium">Visits</th>
                  <th className="text-right py-2 font-medium">Deals</th>
                  <th className="text-right py-2 font-medium">GMV</th>
                  <th className="text-right py-2 font-medium">Conv %</th>
                </tr>
              </thead>
              <tbody>
                {localityRows.map((r) => (
                  <tr key={r.locality} className="border-b border-white/5">
                    <td className="py-2 text-white font-medium">{r.locality}</td>
                    <td className="py-2 text-right tabular-nums text-gray-300">{r.enquiries}</td>
                    <td className="py-2 text-right tabular-nums text-gray-300">{r.visits}</td>
                    <td className="py-2 text-right tabular-nums text-gray-300">{r.deals}</td>
                    <td className="py-2 text-right tabular-nums text-gray-300">{r.gmv ? fmtINR(r.gmv) : '—'}</td>
                    <td className="py-2 text-right tabular-nums">
                      <span className={r.enquiries > 0 && r.deals > 0 ? 'text-emerald-300' : 'text-gray-500'}>
                        {r.enquiries > 0 ? Math.round((r.deals / r.enquiries) * 100) : 0}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default FunnelView;
