import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, CheckCircle2, ClipboardList, Clock, ConciergeBell, Inbox, ShieldAlert, X } from 'lucide-react';
import { listTickets } from '../../lib/mockApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';
import { DoughnutChart, BarChart, PALETTE } from '../../components/charts/index.jsx';

/* Deterministic 8-week resolved series seeded from team so it's stable across reloads. */
function resolvedSeries(team, done) {
  let s = 0;
  for (let i = 0; i < (team || 'x').length; i++) s += (team || 'x').charCodeAt(i);
  const out = [];
  for (let i = 0; i < 8; i++) { s = (s * 1664525 + 1013904223) >>> 0; out.push(3 + (s % 6)); }
  // Nudge last bucket toward the real resolved count for realism
  if (done) out[7] = Math.max(1, Math.round(done / 4));
  return out;
}

/* Friendly labels for the team a staffer was denied access to (matches OPS nav). */
const TEAM_LABELS = {
  rental: 'Rent Agreement',
  legal: 'Property & Legal',
  loans: 'Home Loans',
  interior: 'Interior',
  packers: 'Packers & Movers',
  valuation: 'Valuation',
};

/* Teams with a dedicated ops workflow page; others use the shared tickets queue. */
const WORKFLOW_ROUTE = {
  rental: '/ops/rent-agreement',
  legal: '/ops/legal',
  interior: '/ops/interior',
  packers: '/ops/packers',
  valuation: '/ops/valuation',
};

export default function OpsDashboard() {
  const { team, role } = useAuth();
  const [tickets, setTickets] = useState(null);
  const [params, setParams] = useSearchParams();
  const denied = params.get('denied');
  const dismissDenied = () => { params.delete('denied'); setParams(params, { replace: true }); };

  useEffect(() => {
    let alive = true;
    listTickets(role === 'admin' ? undefined : team).then((t) => alive && setTickets(t));
    return () => { alive = false; };
  }, [team, role]);

  if (!tickets) return <Loading />;

  const counts = { new: 0, in_progress: 0, done: 0, cancelled: 0 };
  tickets.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; });

  const tiles = [
    { label: 'New', value: counts.new, icon: Inbox, tint: 'text-indigo-300 bg-indigo-500/15' },
    { label: 'In Progress', value: counts.in_progress, icon: Clock, tint: 'text-amber-300 bg-amber-500/15' },
    { label: 'Resolved', value: counts.done, icon: CheckCircle2, tint: 'text-emerald-300 bg-emerald-500/15' },
    { label: 'Total', value: tickets.length, icon: ClipboardList, tint: 'text-brand-teal bg-brand-teal/15' },
  ];

  const weeks = resolvedSeries(team, counts.done);
  const recent = tickets.slice(0, 6);

  return (
    <div>
      <PageHeader title="My Dashboard" subtitle={role === 'admin' ? 'All service teams' : `Team: ${team}`} />

      {denied ? (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100" role="alert">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1">
            You don't have access to the <b className="capitalize">{TEAM_LABELS[denied] || denied}</b> queue.
            Ask an admin to add you to that team. Meanwhile, here's your dashboard.
          </div>
          <button onClick={dismissDenied} aria-label="Dismiss" className="rounded-lg p-1 text-amber-200/80 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* KPI tiles */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="pn-card p-4">
            <div className="flex items-start justify-between">
              <div><div className="text-xs text-gray-400">{t.label}</div><div className="mt-1 text-2xl font-extrabold">{t.value}</div></div>
              <span className={`grid h-9 w-9 place-items-center rounded-xl ${t.tint}`}><t.icon className="h-4 w-4" /></span>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="pn-card p-4">
          <h3 className="mb-1 font-bold">My queue status</h3>
          <p className="mb-3 text-xs text-gray-400">Current workload</p>
          <DoughnutChart
            labels={['New', 'In Progress', 'Resolved', 'Cancelled']}
            values={[counts.new, counts.in_progress, counts.done, counts.cancelled]}
            colors={[PALETTE[1], PALETTE[3], '#10b981', '#64748b']}
          />
        </div>
        <div className="pn-card p-4">
          <h3 className="mb-3 font-bold">Resolved — last 8 weeks</h3>
          <BarChart
            labels={['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8']}
            datasets={[{ label: 'Resolved', data: weeks, color: PALETTE[0] }]}
            options={{ scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' } } } }}
          />
        </div>
      </div>

      {/* Latest requests (list) */}
      <div className="pn-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-bold">Latest requests for your team</h3>
          <div className="flex gap-2">
            {team && WORKFLOW_ROUTE[team] && <Link to={WORKFLOW_ROUTE[team]} className="pn-btn pn-btn-ghost py-1 text-xs">Workflow <ArrowRight className="h-3.5 w-3.5" /></Link>}
            <Link to="/ops/requests" className="pn-btn pn-btn-ghost py-1 text-xs">All tickets <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
        </div>
        {recent.length ? (
          <div className="divide-y divide-white/5">
            {recent.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-orange-500/15 text-orange-300"><ConciergeBell className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{t.customer} · {t.detail || t.service}</div>
                  <div className="text-xs text-gray-400">{t.id} · {t.assignedTo ? `Assigned to ${t.assignedTo}` : 'Unassigned'}</div>
                </div>
                <Badge status={t.status} />
                <Link to="/ops/requests" className="pn-btn pn-btn-ghost py-1 text-xs">Open</Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-gray-500">No requests yet 🎉</div>
        )}
      </div>
    </div>
  );
}
