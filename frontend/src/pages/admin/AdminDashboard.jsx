import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ShieldAlert, Flag, Mail, CalendarCheck, ConciergeBell, Handshake, MessageSquareWarning,
  Users, Building2, Building, IndianRupee, Trophy, UserPlus, MousePointerClick,
  ArrowUpRight, CheckCheck, Clock,
} from 'lucide-react';
import { adminDashboard } from '../../services/analyticsService.js';
import { fmtINR, fmtNum } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { canOpenPath, hasPermission, ticketPath } from '../../lib/adminModules.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';
import SlaHealthPanel from './dashboard/SlaHealthPanel.jsx';
import StaffWorkDashboard from './dashboard/StaffWorkDashboard.jsx';

const TINT = {
  amber: 'bg-amber-500/15 text-amber-300',
  rose: 'bg-rose-500/15 text-rose-300',
  indigo: 'bg-indigo-500/15 text-indigo-300',
  teal: 'bg-brand-teal/15 text-brand-teal',
  coral: 'bg-orange-500/15 text-orange-300',
  emerald: 'bg-emerald-500/15 text-emerald-300',
};

const SECTIONS = 'text-lg font-bold';

function StatTile({ tile }) {
  const has = tile.val > 0;
  return (
    <Link
      to={tile.href}
      className={`dz-card group relative flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:border-white/20 ${
        tile.attention && has ? 'border-amber-400/30' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${TINT[tile.tint]}`}>
          <tile.icon className="h-[19px] w-[19px]" />
        </span>
        <ArrowUpRight className="h-4 w-4 text-gray-500 transition group-hover:text-gray-300" />
      </div>
      <div>
        <div className="text-2xl font-extrabold">{tile.display}</div>
        <div className="text-sm text-gray-400">{tile.lbl}</div>
      </div>
      <div
        className={`text-xs font-semibold ${
          tile.attention ? (has ? 'text-amber-300' : 'text-gray-500') : ''
        }`}
        style={tile.attention ? undefined : { color: 'rgb(var(--dz-c-slate-400))' }}
      >
        {tile.attention ? (has ? tile.cta : 'All clear') : tile.sub}
      </div>
    </Link>
  );
}

export default function AdminDashboard() {
  const { user } = useAuth();
  return user?.role === 'staff' ? <StaffWorkDashboard /> : <PlatformDashboard user={user} />;
}

function PlatformDashboard({ user }) {
  const [data, setData] = useState(null);
  const canOpen = (href) => canOpenPath(user, href);

  /* One read. Every figure is counted by the server over the whole set, and a section the caller
     may not read is absent, so its tiles are dropped rather than shown as zero. */
  useEffect(() => {
    let alive = true;
    adminDashboard()
      .then((d) => { if (alive) setData(d); })
      .catch((err) => {
        console.warn('[AdminDashboard] the dashboard could not be read; its tiles are hidden.', err);
        if (alive) setData({});
      });
    return () => { alive = false; };
  }, []);

  if (!data) return <Loading />;

  const { kpis, traffic, sla, listings, demand, tickets, owners } = data;
  const pendingVerif = listings?.pending ?? kpis?.pendingModeration ?? null;
  const openTickets = tickets?.open ?? null;

  const actionTiles = [
    { lbl: 'Pending Verification', val: pendingVerif, icon: ShieldAlert, tint: 'amber', href: '/admin/properties', cta: 'Review listings', show: pendingVerif != null },
    { lbl: 'Needs Follow-up', val: listings?.followUp, icon: Clock, tint: 'rose', href: '/admin/properties?tab=followup', cta: 'Follow up now', show: Boolean(listings) },
    { lbl: 'Flagged Listings', val: listings?.flagged, icon: Flag, tint: 'rose', href: '/admin/properties?tab=flagged', cta: 'Investigate', show: Boolean(listings) },
    { lbl: 'Open Reports', val: kpis?.openReports, icon: MessageSquareWarning, tint: 'rose', href: '/admin/reports', cta: 'Review reports', show: Boolean(kpis) },
    { lbl: 'New Enquiries', val: demand?.newEnquiries, icon: Mail, tint: 'indigo', href: '/admin/enquiries', cta: 'Respond now', show: Boolean(demand) },
    { lbl: 'Scheduled Visits', val: demand?.scheduledVisits, icon: CalendarCheck, tint: 'teal', href: '/admin/enquiries', cta: 'Coordinate', show: Boolean(demand) },
    { lbl: 'Open Service Requests', val: openTickets, icon: ConciergeBell, tint: 'coral', href: ticketPath({ desk: tickets?.openTeam }), cta: 'Assign & start', show: openTickets != null },
    { lbl: 'Deals in Progress', val: demand?.dealsInProgress, icon: Handshake, tint: 'emerald', href: '/admin/enquiries', cta: 'Close deals', show: Boolean(demand) },
  ].filter((t) => t.show && canOpen(t.href)).map((t) => ({ ...t, attention: true, display: fmtNum(t.val) }));
  /* `revenue30d` is null for a `staff` caller by design — the server redacts that one figure rather
     than refusing the read. `fmtINR(null)` would print ₹0, so null hides the tile instead. */
  const glanceTilesAll = [
    { lbl: 'Total Users', val: kpis?.totalUsers, display: fmtNum(kpis?.totalUsers), icon: Users, tint: 'indigo', href: '/admin/users', sub: owners == null ? 'buyers & owners' : `${fmtNum(owners)} owners`, show: Boolean(kpis) },
    { lbl: 'Active Listings', val: kpis?.activeListings, display: fmtNum(kpis?.activeListings), icon: Building2, tint: 'teal', href: '/admin/properties?tab=all', sub: `${fmtNum(kpis?.totalListings)} total`, show: Boolean(kpis) },
    { lbl: 'Revenue (last 30 days)', val: kpis?.revenue30d, display: fmtINR(kpis?.revenue30d), icon: IndianRupee, tint: 'emerald', href: '/admin/finance', sub: 'rolling window', show: kpis?.revenue30d != null },
    { lbl: 'Deals closed (30d)', val: kpis?.dealsClosed30d, display: fmtNum(kpis?.dealsClosed30d), icon: Trophy, tint: 'coral', href: '/admin/enquiries', sub: 'last 30 days', show: Boolean(kpis) },
    { lbl: 'Signups today', val: traffic?.signupsToday, display: fmtNum(traffic?.signupsToday), icon: UserPlus, tint: 'rose', href: '/admin/users', sub: 'new registrations', show: Boolean(traffic) },
    { lbl: 'Visits today', val: traffic?.sessionsToday, display: fmtNum(traffic?.sessionsToday), icon: MousePointerClick, tint: 'indigo', href: '/admin/analytics', sub: `${fmtNum(traffic?.sessions30d)} in 30d`, show: Boolean(traffic) },
  ];
  const glanceTiles = glanceTilesAll.filter((t) => t.show && canOpen(t.href)).map((t) => ({ ...t, attention: false }));

  /* Oldest first, because this card is a queue and not a feed: the listing that has waited longest
     is the one a moderator should open next. */
  const pend = listings?.oldestPending || [];
  const latestTickets = tickets?.latest || [];

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Welcome back — here's what's happening across Draazy" />

      <SlaHealthPanel sla={sla} />

      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={SECTIONS}>Needs attention</h2>
        <span className="text-sm text-gray-500">Click a tile to jump straight to the queue and take action</span>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 sm:[grid-template-columns:repeat(auto-fit,minmax(195px,1fr))]">
        {actionTiles.map((t) => (
          <StatTile key={t.lbl} tile={t} />
        ))}
      </div>

      <div className="mb-3">
        <h2 className={SECTIONS}>At a glance</h2>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 sm:[grid-template-columns:repeat(auto-fit,minmax(195px,1fr))]">
        {glanceTiles.map((t) => (
          <StatTile key={t.lbl} tile={t} />
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={SECTIONS}>Latest activity</h2>
        <span className="text-sm text-gray-500">Most recent items needing a look</span>
      </div>
      {/* min-w-0 on both cards: a grid item defaults to `min-width: auto`, so the track refuses to
          shrink and the rows' existing truncation never gets a chance to run. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {listings && canOpen('/admin/properties') ? (
        <div className="dz-card min-w-0 p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Pending verification</h3>
              <div className="text-xs text-gray-500">Approve or reject new listings</div>
            </div>
            <Link to="/admin/properties" className="dz-btn dz-btn-ghost text-sm">
              View all
            </Link>
          </div>
          {pend.length ? (
            <div>
              {pend.map((l) => (
                <div key={l.id} className="flex items-center gap-3 border-b border-white/10 py-2.5 last:border-0">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${TINT.teal}`}>
                    <Building className="h-[17px] w-[17px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{l.title}</div>
                    <div className="truncate text-xs text-gray-500">
                      {l.locality} · {fmtINR(l.price)} · {l.owner}
                    </div>
                  </div>
                  <Link to="/admin/properties" className="dz-btn dz-btn-primary text-xs">
                    Review
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-gray-400">
              <CheckCheck className="h-6 w-6 text-gray-500" />
              All caught up — nothing pending.
            </div>
          )}
        </div>
        ) : null}

        {tickets && hasPermission(user, 'tickets:read') ? (
        <div className="dz-card min-w-0 p-5">
          <div className="mb-3">
            <h3 className="font-bold">Latest service requests</h3>
            <div className="text-xs text-gray-500">Across all desks</div>
          </div>
          <div>
            {latestTickets.map((t) => (
              <Link
                key={t.id}
                to={ticketPath(t, true)}
                className="flex items-center gap-3 border-b border-white/10 py-2.5 text-inherit no-underline last:border-0"
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${TINT.coral}`}>
                  <ConciergeBell className="h-[17px] w-[17px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{t.service}</div>
                  <div className="truncate text-xs text-gray-500">
                    {t.customer} · {t.detail}
                  </div>
                </div>
                <Badge status={t.status} />
              </Link>
            ))}
          </div>
        </div>
        ) : null}
      </div>
    </div>
  );
}
