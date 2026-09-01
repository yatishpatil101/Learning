import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ShieldAlert, Flag, Mail, CalendarCheck, ConciergeBell, Handshake, MessageSquareWarning,
  Users, Building2, Building, IndianRupee, Trophy, UserPlus, MousePointerClick,
  ShieldCheck, Megaphone, ToggleRight, ExternalLink, ArrowUpRight, CheckCheck, Clock,
} from 'lucide-react';
import { listForModeration } from '../../services/propertyService.js';
import { listEnquiries, listVisits, listDeals } from '../../services/enquiryBoardService.js';
import { listTicketQueue } from '../../services/ticketService.js';
import { listUsers } from '../../services/usersService.js';
import { getSettings } from '../../services/settingsService.js';
import { dashboardKpis, traffic as fetchTraffic } from '../../services/analyticsService.js';
import { isHttpDomain } from '../../services/config.js';
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

  const showGlanceRevenue = optionEnabled('dash.glanceRevenue');
  const showGlanceTraffic = optionEnabled('dash.glanceTraffic');

  /* Every figure on this screen except the listings used to be read straight out of `lib/mockApi.js`,
     below the service seam. With the backend running and every other admin console live, the landing
     page still showed the browser's demo database: total users, enquiries, visits, service requests,
     deals, revenue and the platform-health panel were all seeded numbers, presented without
     qualification beside four listing tiles that were real. It is the first screen an operator opens.

     ## Where each number comes from now, and why the split
     `getAdminKpis()` used to be the tenth call here and its result was never read; the comment that
     replaced it recorded that adopting it was "a product decision, not a cleanup", because the
     server counts the catalogue while this component counted whatever it had happened to fetch. That
     decision has now been taken, and the answer is both, along one line:

       catalogue-wide totals  ->  `dashboardKpis()` (`GET /admin/dashboard`), counted in SQL
       queue depths and rows  ->  the collections the tile links through to

     The totals had to move because the collections are **paged** and the tiles did not say so: the
     enquiry board caps at 100 (`unwrapFullPage`), `/users` and `/tickets` at 20. "Total Users" read
     as a fact about the platform while counting a page, and would have kept reading 20 for ever. The
     queue tiles stay on the collections deliberately — a queue tile is a click-through, and it should
     agree with the list it opens rather than with a number computed somewhere else.

     ## Reads that fail cost a tile, not the page
     Unlike the Analytics tabs, whose entire purpose is their figures, this screen's job is to route
     somebody to the right queue. So the four non-essential reads are caught individually and their
     tiles are hidden rather than zeroed — a dashboard that renders "0 pending" during an outage sends
     the moderation desk home. The three queue reads and the settings read are not caught: without
     them there is no screen. */
  useEffect(() => {
    let alive = true;

    /** A read whose failure costs a tile rather than the page. Logged — never silently swallowed. */
    const soft = (label, promise) =>
      promise.catch((err) => {
        console.warn(`[AdminDashboard] ${label} could not be read; the tiles it feeds are hidden.`, err);
        return null;
      });

    /* The ticket domain is http-only by design — there is no mock ticket provider, because the mock
       store knows three statuses where the server knows five and no honest translation exists (see
       the header of providers/http/ticketProvider.js). Asking for one throws, which inside this
       `Promise.all` would leave the screen on <Loading /> for ever. `OpsQueue` gates the same way. */
    const ticketsAvailable = isHttpDomain('ticket');
    const noTickets = Promise.resolve(null);

    Promise.all([
      listForModeration({}, 'newest'),
      listEnquiries(),
      listVisits(),
      listDeals(),
      /* Five rows for the activity card, and a separate size=1 read purely for its `total`. Two
         requests rather than one because the card wants the newest tickets whatever their state,
         while the tile wants an exact count of one state — and counting the first five would report
         "3 open" on a desk with ninety. `open`, not `new`: `new` is the mock's word and the server
         would reject it. */
      ticketsAvailable ? soft('the service desk', listTicketQueue({ size: 5 })) : noTickets,
      ticketsAvailable ? soft('the service desk', listTicketQueue({ status: 'open', size: 1 })) : noTickets,
      /* Same trick for the owner sub-label: one row fetched, only `total` used. */
      soft('the owner count', listUsers({ role: 'owner', size: 1 })),
      soft('the scorecard', dashboardKpis()),
      soft('traffic', fetchTraffic({ days: 30 })),
      getSettings(),
    ]).then(([listings, enquiries, visits, deals, ticketPage, openTicketPage, ownerPage, kpis, traffic, settings]) => {
      if (!alive) return;
      setData({ listings, enquiries, visits, deals, ticketPage, openTicketPage, ownerPage, kpis, traffic, settings });
    });
    return () => { alive = false; };
  }, []);

  if (!data) return <Loading />;

  const {
    listings, enquiries, visits, deals, ticketPage, openTicketPage, ownerPage, kpis, traffic, settings,
  } = data;

  // Queue depths — over the window each collection returns, which is the same window the tile links
  // through to. `unwrapFullPage` warns in the console on the day one of these overflows.
  const flagged = listings.filter((l) => l.status === 'flagged').length;
  const newEnq = enquiries.filter((x) => x.status === 'new').length;
  const schedVisits = visits.filter((x) => x.status === 'scheduled').length;
  const dealsProg = deals.filter((x) => x.status === 'in_progress').length;

  /* Catalogue-wide, counted by the server. `pendingModeration` falls back to the fetched window when
     the scorecard read failed: this is the tile the moderation desk works from, so a degraded number
     with a console warning beside it beats no tile at all. The glance tiles below take the opposite
     view and disappear, because nobody routes work from them. */
  const pendingVerif = kpis ? kpis.pendingModeration : listings.filter((l) => l.status === 'pending').length;

  const tickets = ticketPage?.items || [];
  const openTickets = openTicketPage?.total ?? null;
  const owners = ownerPage?.total ?? null;

  /* `series` is ordered oldest-first by the server. Note the field: a day carries `sessions`, not
     `visits` — the mock's word. Reading `.visits` here would have found `undefined` on every row and
     rendered a confident zero. */
  const days = traffic?.series || [];
  const lastDay = days[days.length - 1] || null;
  const sessions30 = days.reduce((sum, d) => sum + d.sessions, 0);

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

  /* Tiles whose source went away are dropped rather than left showing a plausible figure:

     - **Owner KYC Pending** counted `role === 'owner' && !verified` in the browser. There is no live
       equivalent: `/users` has no `verified` filter, `AdminKpis` has no such field, and
       `verificationService` is self-service only (`/me/verification/aadhaar`) with no admin queue
       behind it. Recorded in tasks/DECISIONS-NEEDED.md.
     - **New Service Requests** is now **Open**. `new` is the mock's word; `TicketStatuses` knows
       `open, in-progress, waiting, resolved, closed` and the mapper deliberately does not translate,
       so the old filter would have matched nothing live.
     - **Open Reports** takes the freed slot. It is `AdminKpis.openReports` — by its own javadoc "the
       second queue tile tech debt D68 was waiting for" — so the abuse queue finally has a way in
       from the landing page. It hides when the scorecard read fails rather than claiming zero
       reports, which is the one thing a moderation tile must never say wrongly. */
  const actionTiles = [
    { lbl: 'Pending Verification', val: pendingVerif, icon: ShieldAlert, tint: 'amber', href: '/admin/properties', cta: 'Review listings', show: true },
    { lbl: 'Needs Follow-up', val: followUpItems.length, icon: Clock, tint: 'rose', href: '/admin/properties?tab=followup', cta: 'Follow up now', show: true },
    { lbl: 'Flagged Listings', val: flagged, icon: Flag, tint: 'rose', href: '/admin/properties', cta: 'Investigate', show: true },
    { lbl: 'Open Reports', val: kpis?.openReports, icon: MessageSquareWarning, tint: 'rose', href: '/admin/properties?tab=reports', cta: 'Review reports', show: Boolean(kpis) },
    { lbl: 'New Enquiries', val: newEnq, icon: Mail, tint: 'indigo', href: '/admin/enquiries', cta: 'Respond now', show: true },
    { lbl: 'Scheduled Visits', val: schedVisits, icon: CalendarCheck, tint: 'teal', href: '/admin/enquiries', cta: 'Coordinate', show: true },
    { lbl: 'Open Service Requests', val: openTickets, icon: ConciergeBell, tint: 'coral', href: '/admin/services', cta: 'Assign & start', show: openTickets != null },
    { lbl: 'Deals in Progress', val: dealsProg, icon: Handshake, tint: 'emerald', href: '/admin/enquiries', cta: 'Close deals', show: true },
  ].filter((t) => t.show).map((t) => ({ ...t, attention: true, display: fmtNum(t.val) }));

  /* `revenue30d` is null for a `staff` caller by design — the server redacts the one admin-only
     figure rather than refusing the whole read (`AdminKpis` javadoc, spec fix S61). `fmtINR(null)`
     would print ₹0, so null means the tile is not rendered at all, which is what a redaction looks
     like. In practice no staffer reaches this screen — the admin shell refuses them outright — so
     this branch is defence in depth against a future read-only ops console, not something a user
     can watch happen; `live-admin-dashboard.spec.js` pins both halves so they cannot drift apart.
     The MoM delta is gone with it: the server sends one rolling 30-day sum, not a month-by-month
     series, so there is no prior period to compare against without a second read — and the label now
     says "last 30 days" because that is what the number is. Finance keeps the trend line. */
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

      {/* Three panels used to sit on this page — Smart Alerts, SLA Health and the Daily Ops
          Scorecard — and all three were generated in the browser. `slaMetrics()` and
          `dailyOpsScorecard()` drew their figures from `rng(314159)` over the mock store; the
          alerts were computed from `rawDb` directly. All three flags default to **on**, so every
          operator saw them, and the numbers did not move when the thing they measured moved.

          They are removed rather than repointed because there is nothing to repoint them at.
          `reviewSla()` is real but answers a much narrower question than `SlaHealthPanel` renders
          (four of its eight KPIs have no counterpart), and no route produces the alerts or the
          scorecard at all. Each is a row in tasks/DECISIONS-NEEDED.md naming what the backend would
          have to grow. The panel components are left on disk so the work returns cheaply when it
          does. This is the same call `providers/mock/analyticsProvider.js` made when it replaced the
          same generators for the Analytics page: compute it or report the gap, never invent it. */}

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

      {/* At a glance */}
      <div className="mb-3">
        <h2 className={SECTIONS}>At a glance</h2>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 sm:[grid-template-columns:repeat(auto-fit,minmax(195px,1fr))]">
        {glanceTiles.map((t) => (
          <StatTile key={t.lbl} tile={t} />
        ))}
      </div>

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
