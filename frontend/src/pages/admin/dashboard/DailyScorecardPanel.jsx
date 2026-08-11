import { Link } from 'react-router';
import { TrendingUp, TrendingDown, Target } from 'lucide-react';
import { fmtINR, fmtNum } from '../../../lib/format.js';

export default function DailyScorecardPanel({ ops }) {
  if (!ops) return null;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold">Today's scorecard</h2>
        <span className="text-sm text-gray-500">{ops.date} — team performance snapshot</span>
      </div>
      <div className="mb-6 pn-card p-5">
        {/* Metrics grid */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 mb-5">
          {[
            { label: 'Listings approved', today: ops.today.listingsApproved, yesterday: ops.yesterday.listingsApproved, target: ops.targets.listingsApproved },
            { label: 'Tickets completed', today: ops.today.ticketsCompleted, yesterday: ops.yesterday.ticketsCompleted, target: ops.targets.ticketsCompleted },
            { label: 'Enquiries handled', today: ops.today.enquiriesResponded, yesterday: ops.yesterday.enquiriesResponded, target: ops.targets.enquiriesResponded },
            { label: 'Reminders sent', today: ops.today.remindersSent, yesterday: ops.yesterday.remindersSent, target: ops.targets.remindersSent },
            { label: 'Concierge posted', today: ops.today.conciergePosted, yesterday: ops.yesterday.conciergePosted },
            { label: 'Revenue today', today: ops.today.revenueToday, yesterday: ops.yesterday.revenueToday, isCurrency: true },
            { label: 'Total actions', today: ops.today.totalActions, yesterday: ops.yesterday.totalActions, target: ops.targets.totalActions },
          ].map((m) => {
            const delta = m.yesterday > 0 ? Math.round(((m.today - m.yesterday) / m.yesterday) * 100) : 0;
            const atTarget = m.target ? m.today >= m.target : null;
            return (
              <div key={m.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                <div className="text-2xl font-extrabold text-white tabular-nums">{m.isCurrency ? fmtINR(m.today) : fmtNum(m.today)}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 mb-2">{m.label}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {delta !== 0 && (
                    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${delta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {delta > 0 ? '+' : ''}{delta}%
                    </span>
                  )}
                  {atTarget !== null && (
                    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${atTarget ? 'text-emerald-400' : 'text-amber-400'}`}>
                      <Target className="h-3 w-3" />
                      {atTarget ? 'Hit' : `${m.today}/${m.target}`}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Staff leaderboard + targets */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-200">Top performers today</span>
              <Link to="/admin/staff-activity" className="tap-target inline-flex items-center justify-end text-[11px] text-teal-400 hover:text-teal-300 transition-colors">View all →</Link>
            </div>
            <div className="space-y-2.5">
              {ops.staffBreakdown.map((s, i) => (
                <div key={s.name} className="flex items-center gap-3">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-[11px] font-bold text-gray-300">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-200 truncate">{s.name}</span>
                      <span className="text-xs font-semibold text-white tabular-nums">{s.count}</span>
                    </div>
                    <div className="mt-1 relative h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-teal-500/70" style={{ width: `${Math.min((s.count / (ops.targets.totalActions / (ops.staffBreakdown.length || 1))) * 100, 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <span className="text-sm font-semibold text-gray-200 mb-3 block">Daily targets</span>
            <div className="space-y-3">
              {[
                { label: 'Listings approved', val: ops.today.listingsApproved, target: ops.targets.listingsApproved },
                { label: 'Tickets completed', val: ops.today.ticketsCompleted, target: ops.targets.ticketsCompleted },
                { label: 'Enquiries handled', val: ops.today.enquiriesResponded, target: ops.targets.enquiriesResponded },
                { label: 'Reminders sent', val: ops.today.remindersSent, target: ops.targets.remindersSent },
                { label: 'Total actions', val: ops.today.totalActions, target: ops.targets.totalActions },
              ].map((t) => {
                const pct = Math.min(Math.round((t.val / t.target) * 100), 100);
                return (
                  <div key={t.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-400">{t.label}</span>
                      <span className={`text-xs font-semibold tabular-nums ${pct >= 100 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-300' : 'text-gray-400'}`}>{t.val}/{t.target}</span>
                    </div>
                    <div className="relative h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className={`absolute inset-y-0 left-0 rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-white/20'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
