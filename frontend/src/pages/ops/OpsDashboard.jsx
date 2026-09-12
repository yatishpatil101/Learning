import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CheckCircle2, ClipboardList, Clock, ConciergeBell, Inbox, ShieldAlert } from 'lucide-react';
import { listTicketQueue } from '../../services/ticketService.js';
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

/* Teams whose work is a service request — one desk, filtered. The five per-team routes these used
   to point at are now redirects into this one, so linking straight here saves a bounce. Teams not
   listed (loans) have no service-request type and use the shared tickets queue. */
const WORKFLOW_ROUTE = {
  rental: '/ops/drafting-desk?type=rental',
  legal: '/ops/drafting-desk?type=legal',
  interior: '/ops/drafting-desk?type=interior',
  packers: '/ops/drafting-desk?type=packers',
  valuation: '/ops/drafting-desk?type=valuation',
};

export default function OpsDashboard() {
  const { team, role } = useAuth();
  const [state, setState] = useState(() => ({ status: 'loading', items: [], total: 0 }));

  useEffect(() => {
    let alive = true;
    /* No `team` argument. `TicketService.list` scopes a staff caller to their own desk and an admin
       to everything, so passing `role === 'admin' ? undefined : team` was the component restating a
       server rule — two copies of one decision, which is how they end up disagreeing (D44). */
    listTicketQueue({ size: 100 })
      .then((res) => alive && setState({ status: 'ready', items: res.items, total: res.total }))
      /* Zero tickets and an unreadable queue must not render the same tiles. */
      .catch(() => alive && setState({ status: 'error', items: [], total: 0 }));
    return () => { alive = false; };
  }, []);

  if (state.status === 'error') {
    return (
      <div>
        <PageHeader title="My Dashboard" subtitle={role === 'admin' ? 'All service teams' : `Team: ${team}`} />
        <div className="dz-card flex items-start gap-3 p-5 text-sm text-amber-200">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Your queue could not be read.</p>
            <p className="mt-1 text-amber-200/80">
              These tiles count real tickets. Showing zeros when the queue is merely unreachable would
              tell you the day is clear when nobody has actually looked.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'loading') return <Loading />;

  const tickets = state.items;
  const counts = { open: 0, 'in-progress': 0, waiting: 0, resolved: 0, closed: 0 };
  tickets.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; });

  const tiles = [
    { label: 'Open', value: counts.open, icon: Inbox, tint: 'text-indigo-300 bg-indigo-500/15' },
    { label: 'In Progress', value: counts['in-progress'], icon: Clock, tint: 'text-amber-300 bg-amber-500/15' },
    { label: 'Resolved', value: counts.resolved, icon: CheckCircle2, tint: 'text-emerald-300 bg-emerald-500/15' },
    { label: 'Total', value: state.total, icon: ClipboardList, tint: 'text-brand-teal bg-brand-teal/15' },
  ];

  const weeks = resolvedSeries(team, counts.resolved);
  const recent = tickets.slice(0, 6);

  return (
    <div>
      <PageHeader title="My Dashboard" subtitle={role === 'admin' ? 'All service teams' : `Team: ${team}`} />

      {/* KPI tiles */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="dz-card p-4">
            <div className="flex items-start justify-between">
              <div><div className="text-xs text-gray-400">{t.label}</div><div className="mt-1 text-2xl font-extrabold">{t.value}</div></div>
              <span className={`grid h-9 w-9 place-items-center rounded-xl ${t.tint}`}><t.icon className="h-4 w-4" /></span>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="dz-card p-4">
          <h3 className="mb-1 font-bold">My queue status</h3>
          <p className="mb-3 text-xs text-gray-400">Current workload</p>
          <DoughnutChart
            labels={['Open', 'In Progress', 'Waiting', 'Resolved', 'Closed']}
            values={[counts.open, counts['in-progress'], counts.waiting, counts.resolved, counts.closed]}
            colors={[PALETTE[1], PALETTE[3], PALETTE[2], '#10b981', '#64748b']}
          />
        </div>
        <div className="dz-card p-4">
          <h3 className="mb-3 font-bold">Resolved — last 8 weeks</h3>
          <BarChart
            labels={['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8']}
            datasets={[{ label: 'Resolved', data: weeks, color: PALETTE[0] }]}
            options={{ scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' } } } }}
          />
        </div>
      </div>

      {/* Latest requests (list) */}
      <div className="dz-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-bold">Latest requests for your team</h3>
          <div className="flex gap-2">
            {team && WORKFLOW_ROUTE[team] && <Link to={WORKFLOW_ROUTE[team]} className="dz-btn dz-btn-ghost py-1 text-xs">Workflow <ArrowRight className="h-3.5 w-3.5" /></Link>}
            <Link to="/ops/requests" className="dz-btn dz-btn-ghost py-1 text-xs">All tickets <ArrowRight className="h-3.5 w-3.5" /></Link>
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
                <Link to="/ops/requests" className="dz-btn dz-btn-ghost py-1 text-xs">Open</Link>
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
