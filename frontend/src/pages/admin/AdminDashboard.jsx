import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ShieldAlert, Flag, Mail, CalendarCheck, ConciergeBell, Handshake, MessageSquareWarning,
  Users, Building2, Building, IndianRupee, Trophy, UserPlus, MousePointerClick,
  ShieldCheck, Megaphone, ToggleRight, ExternalLink, ArrowUpRight, CheckCheck, Clock,
} from 'lucide-react';
import { listForModeration, moderationSummary } from '../../services/propertyService.js';
import { listEnquiries, listVisits, listDeals } from '../../services/enquiryBoardService.js';
import { listTicketQueue } from '../../services/ticketService.js';
import { listUsers } from '../../services/usersService.js';
import { getSettings } from '../../services/settingsService.js';
import { dashboardKpis, traffic as fetchTraffic } from '../../services/analyticsService.js';
import { fmtINR, fmtNum } from '../../lib/format.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';

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

  const showGlanceRevenue = optionEnabled('dash.glanceRevenue');
  const showGlanceTraffic = optionEnabled('dash.glanceTraffic');

  /* Queue depths come from the paged collections their tiles link through to, so a tile always
     agrees with the list it opens. A non-essential read hides its tile rather than zeroing it. */
  useEffect(() => {
    let alive = true;

    // A read whose failure costs a tile rather than the page.
    const soft = (label, promise) =>
      promise.catch((err) => {
        console.warn(`[AdminDashboard] ${label} could not be read; the tiles it feeds are hidden.`, err);
        return null;
      });

    Promise.all([
      /* Pending-only and `oldest`-first: every use below wants the listings waiting longest, and a
         newest-first page cap drops precisely those. */
      listForModeration({ status: 'pending', archived: false }, 'oldest'),
      soft('the catalogue counters', moderationSummary()),
      listEnquiries(),
      listVisits(),
      listDeals(),
      /* Two reads: the card wants the newest tickets whatever their state, the tile wants an exact
         count of one state — counting the first five would report "3 open" on a desk with ninety. */
      soft('the service desk', listTicketQueue({ size: 5 })),
      soft('the service desk', listTicketQueue({ status: 'open', size: 1 })),
      // Same trick for the owner sub-label: one row fetched, only `total` used.
      soft('the owner count', listUsers({ role: 'owner', size: 1 })),
      soft('the scorecard', dashboardKpis()),
      soft('traffic', fetchTraffic({ days: 30 })),
      getSettings(),
    ]).then(([listings, summary, enquiries, visits, deals, ticketPage, openTicketPage, ownerPage, kpis, traffic, settings]) => {
      if (!alive) return;
      setData({ listings, summary, enquiries, visits, deals, ticketPage, openTicketPage, ownerPage, kpis, traffic, settings });
    });
    return () => { alive = false; };
  }, []);

  if (!data) return <Loading />;

  const {
    listings, summary, enquiries, visits, deals, ticketPage, openTicketPage, ownerPage, kpis, traffic, settings,
  } = data;

  // Queue depths — over the window each collection returns, which is the same window the tile links
  // through to. `unwrapFullPage` warns in the console on the day one of these overflows.
  const newEnq = enquiries.filter((x) => x.status === 'new').length;
  const schedVisits = visits.filter((x) => x.status === 'scheduled').length;
  const dealsProg = deals.filter((x) => x.status === 'in_progress').length;

  /* Counted by the server over the whole catalogue: a browser-side filter over a paged window
     reports a queue as shorter than it is. Null on a failed read, which hides the tile. */
  const flagged = summary?.flagged ?? null;

  /* Never `listings.length`, which is a page of the queue and would report the page as the backlog.
     Degrades to the counters rather than vanishing — the desk routes work from this tile. */
  const pendingVerif = kpis ? kpis.pendingModeration : summary?.pending ?? null;

  const tickets = ticketPage?.items || [];
  const openTickets = openTicketPage?.total ?? null;
  const owners = ownerPage?.total ?? null;

  /* `series` is ordered oldest-first by the server. Note the field: a day carries `sessions`, not
     `visits`. Reading `.visits` here finds `undefined` on every row and renders a confident zero. */
  const days = traffic?.series || [];
  const lastDay = days[days.length - 1] || null;
  const sessions30 = days.reduce((sum, d) => sum + d.sessions, 0);

  /* `listings` arrives pending-only and oldest-first, so these five are the oldest in the catalogue
     rather than in a page. Widen the query if this card ever wants a second status, not the filter. */
  const now = Date.now();
  const staleListings = listings
    .filter((l) => {
      if (l.status !== 'pending') return false;
      const created = new Date(l.createdAt).getTime();
      return (now - created) > 48 * 60 * 60 * 1000;
    })
    .slice(0, 5);

  /* No server-side filter exists for "claimed but finished neither photos nor Aadhaar", so it stays
     a client filter — but over the oldest pending listings, which surfaces the ones stuck longest. */
  const awaitingOwner = listings
    .filter((l) => l.postedByAdmin && l.status === 'pending' && (!l.photosUploaded || !l.identityVerified))
    .slice(0, 5);

  const followUpItems = [...staleListings, ...awaitingOwner]
    .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i);

  /* A tile whose source went away is dropped rather than left showing a plausible figure. Owner KYC
     Pending has no live equivalent here, so its slot goes to Open Reports. */
  const actionTiles = [
    { lbl: 'Pending Verification', val: pendingVerif, icon: ShieldAlert, tint: 'amber', href: '/admin/properties', cta: 'Review listings', show: pendingVerif != null },
    { lbl: 'Needs Follow-up', val: followUpItems.length, icon: Clock, tint: 'rose', href: '/admin/properties?tab=followup', cta: 'Follow up now', show: true },
    { lbl: 'Flagged Listings', val: flagged, icon: Flag, tint: 'rose', href: '/admin/properties', cta: 'Investigate', show: flagged != null },
    { lbl: 'Open Reports', val: kpis?.openReports, icon: MessageSquareWarning, tint: 'rose', href: '/admin/properties?tab=reports', cta: 'Review reports', show: Boolean(kpis) },
    { lbl: 'New Enquiries', val: newEnq, icon: Mail, tint: 'indigo', href: '/admin/enquiries', cta: 'Respond now', show: true },
    { lbl: 'Scheduled Visits', val: schedVisits, icon: CalendarCheck, tint: 'teal', href: '/admin/enquiries', cta: 'Coordinate', show: true },
    { lbl: 'Open Service Requests', val: openTickets, icon: ConciergeBell, tint: 'coral', href: '/admin/services', cta: 'Assign & start', show: openTickets != null },
    { lbl: 'Deals in Progress', val: dealsProg, icon: Handshake, tint: 'emerald', href: '/admin/enquiries', cta: 'Close deals', show: true },
  ].filter((t) => t.show).map((t) => ({ ...t, attention: true, display: fmtNum(t.val) }));

  /* `revenue30d` is null for a `staff` caller by design — the server redacts that one figure rather
     than refusing the read. `fmtINR(null)` would print ₹0, so null hides the tile instead. */
  const glanceTilesAll = [
    { lbl: 'Total Users', val: kpis?.totalUsers, display: fmtNum(kpis?.totalUsers), icon: Users, tint: 'indigo', href: '/admin/users', sub: owners == null ? 'buyers & owners' : `${fmtNum(owners)} owners`, show: Boolean(kpis) },
    { lbl: 'Active Listings', val: kpis?.activeListings, display: fmtNum(kpis?.activeListings), icon: Building2, tint: 'teal', href: '/admin/properties', sub: `${fmtNum(kpis?.totalListings)} total`, show: Boolean(kpis) },
    { lbl: 'Revenue (last 30 days)', val: kpis?.revenue30d, display: fmtINR(kpis?.revenue30d), icon: IndianRupee, tint: 'emerald', href: '/admin/finance', sub: 'rolling window', show: showGlanceRevenue && kpis?.revenue30d != null },
    { lbl: 'Deals closed (30d)', val: kpis?.dealsClosed30d, display: fmtNum(kpis?.dealsClosed30d), icon: Trophy, tint: 'coral', href: '/admin/enquiries', sub: 'last 30 days', show: Boolean(kpis) },
    { lbl: 'Signups today', val: lastDay?.signups, display: fmtNum(lastDay?.signups), icon: UserPlus, tint: 'rose', href: '/admin/users', sub: 'new registrations', show: Boolean(lastDay) },
    { lbl: 'Visits today', val: lastDay?.sessions, display: fmtNum(lastDay?.sessions), icon: MousePointerClick, tint: 'indigo', href: '/admin/analytics', sub: `${fmtNum(sessions30)} in 30d`, show: showGlanceTraffic && Boolean(lastDay) },
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

  /* Oldest first, because this card is a queue and not a feed: the listing that has waited longest
     is the one a moderator should open next. */
  const pend = listings.filter((l) => l.status === 'pending').slice(0, 5);
  const latestTickets = tickets.slice(0, 5);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Welcome back — here's what's happening across Draazy" />

      {/* Smart Alerts, SLA Health and the Daily Ops Scorecard are absent because no route produces
          their data; each is a row in tasks/DECISIONS-NEEDED.md and the components stay on disk. */}

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
        <h2 className={SECTIONS}>Platform health &amp; quick actions</h2>
        <span className="text-sm text-gray-500">System status pulled live from your settings</span>
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="dz-card p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Platform health</h3>
              <div className="text-xs text-gray-500">Services, integrations &amp; system switches</div>
            </div>
            <Link to="/admin/settings" className="dz-btn dz-btn-ghost text-sm">
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

        <div className="dz-card p-5">
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

      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={SECTIONS}>Latest activity</h2>
        <span className="text-sm text-gray-500">Most recent items needing a look</span>
      </div>
      {/* min-w-0 on both cards: a grid item defaults to `min-width: auto`, so the track refuses to
          shrink and the rows' existing truncation never gets a chance to run. */}
      <div className="grid gap-4 lg:grid-cols-2">
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

        <div className="dz-card min-w-0 p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Latest service requests</h3>
              <div className="text-xs text-gray-500">Across all teams</div>
            </div>
            <Link to="/admin/services" className="dz-btn dz-btn-ghost text-sm">
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
