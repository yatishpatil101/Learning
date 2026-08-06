import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ShieldAlert, Flag, Mail, CalendarCheck, ConciergeBell, Handshake, BadgeCheck,
  Users, Building2, Building, IndianRupee, Trophy, UserPlus, MousePointerClick,
  ShieldCheck, Megaphone, ToggleRight, ExternalLink, ArrowUpRight, CheckCheck, Clock,
} from 'lucide-react';
import {
  getAdminKpis, getAnalytics, getSettings, listEnquiries,
  listVisits, listTickets, listDeals, listUsers,
} from '../../lib/mockApi.js';
import { listForModeration } from '../../services/propertyService.js';
import { fmtINR, fmtNum } from '../../lib/format.js';
import { slaMetrics, computeSmartAlerts, dailyOpsScorecard } from '../../lib/data/analytics-extra.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';
import SmartAlertsPanel from './dashboard/SmartAlertsPanel.jsx';
import SlaHealthPanel from './dashboard/SlaHealthPanel.jsx';
import DailyScorecardPanel from './dashboard/DailyScorecardPanel.jsx';

const TINT = {
  amber: 'bg-amber-500/15 text-amber-300',
  rose: 'bg-rose-500/15 text-rose-300',
  indigo: 'bg-indigo-500/15 text-indigo-300',
  teal: 'bg-brand-teal/15 text-brand-teal',
  coral: 'bg-orange-500/15 text-orange-300',
  emerald: 'bg-emerald-500/15 text-emerald-300',
};

const DOT = { green: '#34d399', red: '#fb7185', amber: '#fbbf24', slate: '#94a3b8' };

const SECTIONS = 'text-lg font-bold';

function pct(cur, prev) {
  if (!prev) return { txt: 'no prior data' };
  const d = Math.round(((cur - prev) / prev) * 1000) / 10;
  return { txt: (d >= 0 ? '+' : '') + d + '%', up: d >= 0 };
}

function StatTile({ tile }) {
  const has = tile.val > 0;
  return (
    <Link
      to={tile.href}
      className={`pn-card group relative flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:border-white/20 ${
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
        style={tile.attention ? undefined : { color: '#94a3b8' }}
      >
        {tile.attention ? (has ? tile.cta : 'All clear') : tile.sub}
      </div>
    </Link>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const { optionEnabled } = useAdminFlags();

  const showSmartAlerts = optionEnabled('dash.smartAlerts');
  const showSla = optionEnabled('dash.sla');
  const showScorecard = optionEnabled('dash.scorecard');
  const showGlanceRevenue = optionEnabled('dash.glanceRevenue');
  const showGlanceTraffic = optionEnabled('dash.glanceTraffic');

  useEffect(() => {
    let alive = true;
    Promise.all([
      getAdminKpis(),
      listForModeration({}, 'newest'),
      listEnquiries(),
      listVisits(),
      listTickets(),
      listDeals(),
      listUsers(),
      getAnalytics(),
      getSettings(),
    ]).then(([kpis, listings, enquiries, visits, tickets, deals, users, analytics, settings]) => {
      if (!alive) return;
      setData({ kpis, listings, enquiries, visits, tickets, deals, users, analytics, settings });
    });
    return () => { alive = false; };
  }, []);

  const sla = useMemo(() => (showSla ? slaMetrics() : null), [showSla]);
  const allAlerts = useMemo(() => (showSmartAlerts ? computeSmartAlerts() : []), [showSmartAlerts]);
  const ops = useMemo(() => (showScorecard ? dailyOpsScorecard() : null), [showScorecard]);
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pn_dismissed_alerts') || '[]'); } catch { return []; }
  });
  const alerts = allAlerts.filter((a) => !dismissed.includes(a.id));
  const dismissAlert = (id) => {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem('pn_dismissed_alerts', JSON.stringify(next));
  };

  if (!data) return <Loading />;

  const { listings, enquiries, visits, tickets, deals, users, analytics, settings } = data;

  const pendingVerif = listings.filter((l) => l.status === 'pending').length;
  const flagged = listings.filter((l) => l.status === 'flagged').length;
  const activeListings = listings.filter((l) => l.status === 'approved').length;
  const totalListings = listings.length;
  const totalUsers = users.filter((u) => u.role === 'buyer' || u.role === 'owner').length;
  const owners = users.filter((u) => u.role === 'owner').length;
  const newEnq = enquiries.filter((x) => x.status === 'new').length;
  const schedVisits = visits.filter((x) => x.status === 'scheduled').length;
  const newTickets = tickets.filter((x) => x.status === 'new').length;
  const dealsProg = deals.filter((x) => x.status === 'in_progress').length;
  const kycPending = users.filter((u) => u.role === 'owner' && !u.verified).length;

  const rev = analytics?.revenue || [];
  const total = (m) => m.subscriptions + m.services + m.featured;
  const monthRevenue = rev.length ? total(rev[rev.length - 1]) : 0;
  const revDelta =
    rev.length >= 2 ? pct(total(rev[rev.length - 1]), total(rev[rev.length - 2])) : { txt: 'no prior data' };

  const traffic = analytics?.traffic || [];
  const lastDay = traffic[traffic.length - 1] || { visits: 0, signups: 0 };
  const visits30 = traffic.reduce((a, b) => a + b.visits, 0);

  // Stale listings: pending for >48 hours
  const now = Date.now();
  const staleListings = listings
    .filter((l) => {
      if (l.status !== 'pending') return false;
      const created = new Date(l.createdAt).getTime();
      return (now - created) > 48 * 60 * 60 * 1000;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, 5);

  // Owners who received claim link but haven't completed (no photos OR no Aadhaar)
  const awaitingOwner = listings
    .filter((l) => l.postedByAdmin && l.status === 'pending' && (!l.photosUploaded || !l.aadhaarVerified))
    .slice(0, 5);

  const followUpItems = [...staleListings, ...awaitingOwner]
    .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i);

  const actionTiles = [
    { lbl: 'Pending Verification', val: pendingVerif, icon: ShieldAlert, tint: 'amber', href: '/admin/properties', cta: 'Review listings' },
    { lbl: 'Needs Follow-up', val: followUpItems.length, icon: Clock, tint: 'rose', href: '/admin/properties?tab=followup', cta: 'Follow up now' },
    { lbl: 'Flagged Listings', val: flagged, icon: Flag, tint: 'rose', href: '/admin/properties', cta: 'Investigate' },
    { lbl: 'New Enquiries', val: newEnq, icon: Mail, tint: 'indigo', href: '/admin/enquiries', cta: 'Respond now' },
    { lbl: 'Scheduled Visits', val: schedVisits, icon: CalendarCheck, tint: 'teal', href: '/admin/enquiries', cta: 'Coordinate' },
    { lbl: 'New Service Requests', val: newTickets, icon: ConciergeBell, tint: 'coral', href: '/admin/services', cta: 'Assign & start' },
    { lbl: 'Deals in Progress', val: dealsProg, icon: Handshake, tint: 'emerald', href: '/admin/enquiries', cta: 'Close deals' },
    { lbl: 'Owner KYC Pending', val: kycPending, icon: BadgeCheck, tint: 'amber', href: '/admin/users', cta: 'Verify owners' },
  ].map((t) => ({ ...t, attention: true, display: fmtNum(t.val) }));

  const glanceTilesAll = [
    { lbl: 'Total Users', val: totalUsers, display: fmtNum(totalUsers), icon: Users, tint: 'indigo', href: '/admin/users', sub: `${fmtNum(owners)} owners`, show: true },
    { lbl: 'Active Listings', val: activeListings, display: fmtNum(activeListings), icon: Building2, tint: 'teal', href: '/admin/properties', sub: `${fmtNum(totalListings)} total`, show: true },
    { lbl: 'Revenue (this month)', val: monthRevenue, display: fmtINR(monthRevenue), icon: IndianRupee, tint: 'emerald', href: '/admin/settings', sub: `${revDelta.txt} MoM`, show: showGlanceRevenue },
    { lbl: 'Total Deals', val: deals.length, display: fmtNum(deals.length), icon: Trophy, tint: 'coral', href: '/admin/enquiries', sub: 'all time', show: true },
    { lbl: 'Signups today', val: lastDay.signups, display: fmtNum(lastDay.signups), icon: UserPlus, tint: 'rose', href: '/admin/users', sub: 'new registrations', show: true },
    { lbl: 'Visits today', val: lastDay.visits, display: fmtNum(lastDay.visits), icon: MousePointerClick, tint: 'indigo', href: '/admin', sub: `${fmtNum(visits30)} in 30d`, show: showGlanceTraffic },
  ];
  const glanceTiles = glanceTilesAll.filter((t) => t.show).map((t) => ({ ...t, attention: false }));

  const f = (settings && settings.flags) || {};
  const svcKeys = ['svcRentAgreement', 'svcLegal', 'svcValuation', 'svcInterior', 'svcPackers', 'svcHomeLoans', 'societySaaS'];
  const svcOn = svcKeys.filter((kk) => f[kk]).length;
  const health = [
    { lbl: 'Site status', color: f.maintenanceMode ? DOT.red : DOT.green, txt: f.maintenanceMode ? 'Maintenance mode' : 'Online' },
    { lbl: 'Public signups', color: f.signupsEnabled ? DOT.green : DOT.amber, txt: f.signupsEnabled ? 'Open' : 'Closed' },
    { lbl: 'Staff & ops login', color: f.staffLoginEnabled ? DOT.green : DOT.amber, txt: f.staffLoginEnabled ? 'Enabled' : 'Disabled' },
    { lbl: 'Services live', color: svcOn ? DOT.green : DOT.red, txt: `${svcOn} of ${svcKeys.length} enabled` },
    { lbl: 'Online rent payments', color: f.onlineRentPayment ? DOT.green : DOT.slate, txt: f.onlineRentPayment ? 'On' : 'Off' },
    { lbl: 'WhatsApp integration', color: f.whatsappEnabled ? DOT.green : DOT.slate, txt: f.whatsappEnabled ? 'Connected' : 'Off' },
  ];

  const quick = [
    { lbl: 'Post on behalf', icon: UserPlus, href: '/admin/post-on-behalf' },
    { lbl: 'Verify listings', icon: ShieldCheck, href: '/admin/properties' },
    { lbl: 'Add staff', icon: UserPlus, href: '/admin/users' },
    { lbl: 'New announcement', icon: Megaphone, href: '/admin/content' },
    { lbl: 'Manage services', icon: ConciergeBell, href: '/admin/services' },
    { lbl: 'Feature flags', icon: ToggleRight, href: '/admin/settings' },
    { lbl: 'View live site', icon: ExternalLink, href: '/' },
  ];

  const pend = listings.filter((l) => l.status === 'pending').slice(0, 5);
  const latestTickets = tickets.slice(0, 5);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Welcome back — here's what's happening across PuneNest" />

      {/* Smart Alerts */}
      {showSmartAlerts && <SmartAlertsPanel alerts={alerts} onDismiss={dismissAlert} />}

      {/* Needs attention */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={SECTIONS}>Needs attention</h2>
        <span className="text-sm text-gray-500">Click a tile to jump straight to the queue and take action</span>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 sm:[grid-template-columns:repeat(auto-fit,minmax(195px,1fr))]">
        {actionTiles.map((t) => (
          <StatTile key={t.lbl} tile={t} />
        ))}
      </div>

      {/* SLA Indicators */}
      {showSla && <SlaHealthPanel sla={sla} />}

      {/* At a glance */}
      <div className="mb-3">
        <h2 className={SECTIONS}>At a glance</h2>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 sm:[grid-template-columns:repeat(auto-fit,minmax(195px,1fr))]">
        {glanceTiles.map((t) => (
          <StatTile key={t.lbl} tile={t} />
        ))}
      </div>

      {/* Daily Ops Scorecard */}
      {showScorecard && <DailyScorecardPanel ops={ops} />}

      {/* Platform health & quick actions */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={SECTIONS}>Platform health &amp; quick actions</h2>
        <span className="text-sm text-gray-500">System status pulled live from your settings</span>
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="pn-card p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Platform health</h3>
              <div className="text-xs text-gray-500">Services, integrations &amp; system switches</div>
            </div>
            <Link to="/admin/settings" className="pn-btn pn-btn-ghost text-sm">
              Manage
            </Link>
          </div>
          <div>
            {health.map((h) => (
              <div key={h.lbl} className="flex items-center justify-between gap-3 border-b border-white/10 py-3 last:border-0">
                <span className="text-sm text-gray-200">{h.lbl}</span>
                <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-gray-300">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.color }} />
                  {h.txt}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="pn-card p-5">
          <div className="mb-3">
            <h3 className="font-bold">Quick actions</h3>
            <div className="text-xs text-gray-500">Jump to common tasks</div>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {quick.map((q) => (
              <Link
                key={q.lbl}
                to={q.href}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 text-sm font-semibold text-gray-200 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10"
              >
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-ink-2">
                  <q.icon className="h-[17px] w-[17px]" />
                </span>
                {q.lbl}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Latest activity */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={SECTIONS}>Latest activity</h2>
        <span className="text-sm text-gray-500">Most recent items needing a look</span>
      </div>
      {/* min-w-0 on both cards: a grid item defaults to `min-width: auto`, so the
         track refuses to shrink below the widest thing inside it. The rows here are
         already built to truncate (`min-w-0 flex-1` + `truncate`), but that never got
         a chance to run — the card grew to fit a listing title instead, and at 390px
         it overflowed the viewport by 14px with the right-hand Review button clipped
         off screen. One property, and the truncation that was always there starts
         working. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="pn-card min-w-0 p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Pending verification</h3>
              <div className="text-xs text-gray-500">Approve or reject new listings</div>
            </div>
            <Link to="/admin/properties" className="pn-btn pn-btn-ghost text-sm">
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
                  <Link to="/admin/properties" className="pn-btn pn-btn-primary text-xs">
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

        <div className="pn-card min-w-0 p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Latest service requests</h3>
              <div className="text-xs text-gray-500">Across all teams</div>
            </div>
            <Link to="/admin/services" className="pn-btn pn-btn-ghost text-sm">
              View all
            </Link>
          </div>
          <div>
            {latestTickets.map((t) => (
              <Link
                key={t.id}
                to="/admin/services"
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
      </div>
    </div>
  );
}
