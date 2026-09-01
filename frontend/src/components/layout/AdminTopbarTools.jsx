import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, Bell, Building2, User, Wrench, ShieldCheck, LayoutDashboard, BarChart3, MessageSquare, FileText, Flag, LifeBuoy, Users, Settings, IndianRupee, Gift, Handshake, Mail, Compass, BookOpen } from 'lucide-react';
/* The Ctrl+K palette. Register item 22 in `tasks/DECISIONS-NEEDED.md`, now taken.

   This block used to end: "Not fixed here because there is no admin global-search endpoint to fix
   it with … the recommendation is to hide the five data categories behind `isHttpDomain` until one
   of them is chosen." The first half is still true — `Routes.java` has no `SEARCH` constant, and
   fanning out across `/admin/users`, the moderation list, `/tickets` and `/service-requests` is a
   new cross-domain capability with real questions about debouncing, partial 403s for a
   staff-scoped caller, and whether an admin global search needs its own audit trail. The
   conclusion drawn from it was wrong. The absence of an endpoint is a reason this palette cannot
   search the *server*; it was never a reason to go on presenting `db.json` as though it had.

   So the recommendation the old comment was waiting on is the code below. */
import { rawDb } from '../../lib/mockApi.js';
import { fmtINR } from '../../lib/format.js';
import { isHttpDomain } from '../../services/config.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';

/* Seven search categories. `pages` and `features` are static arrays in this file and are correct on
   every deployment. The other five read `rawDb()` — a synchronous read of the localStorage store
   that `main.jsx` seeds from `db.json` at boot, unconditionally and with no reference to the domain
   allow-list.

   In mock mode that store *is* the system being administered, and the results are right. The moment
   a domain goes live the store is a stale copy of a fixture file: the palette was handing an
   operator 80 fixture listings and 62 fixture users dressed as production rows, whose ids resolve
   to nothing on the console each result links to, with nothing on screen to say where they came
   from. A confident wrong answer is worse than no answer.

   Each category therefore names the domain that owns its rows, and is searched only while that
   domain is still served by its mock provider. Per category rather than one global flag because the
   allow-list is per domain: on a build with only `property` live, the ticket rows in the store are
   still the ticket rows the app is writing, and hiding them would be its own small lie.

   The cost is real and is the point of item 22's option (2): on a live build this palette is a
   nav-jumper. Options (1) — the fan-out — and (3) — one narrow `GET /admin/search` over listings
   and users only — both remain open, and both are product decisions rather than ports.

   Module constants, not hooks: `isHttpDomain` reads a build-time env var, so nothing can move these
   after the bundle is built and re-deriving them per render would only imply otherwise. */
const DATA_CATEGORIES = [
  { key: 'listings', chip: 'Listings', noun: 'listings', domain: 'property' },
  { key: 'users', chip: 'People', noun: 'people', domain: 'users' },
  { key: 'tickets', chip: 'Services', noun: 'service requests', domain: 'ticket' },
  { key: 'enquiries', chip: 'Enquiries', noun: 'enquiries', domain: 'contact' },
  { key: 'deals', chip: 'Deals', noun: 'deals', domain: 'deal' },
];

/** `true` for a category whose rows the browser store is still the authority on. */
const SEARCHABLE = Object.fromEntries(
  DATA_CATEGORIES.map((c) => [c.key, !isHttpDomain(c.domain)]),
);

const SEARCHABLE_DATA = DATA_CATEGORIES.filter((c) => SEARCHABLE[c.key]);
const WITHHELD = DATA_CATEGORIES.filter((c) => !SEARCHABLE[c.key]);
const ANY_DATA_SEARCHABLE = WITHHELD.length < DATA_CATEGORIES.length;

/** "a", "a and b", "a, b and c" — so the note below reads as a sentence rather than a list. */
const prose = (words) =>
  words.length < 2 ? (words[0] || '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

const WITHHELD_PROSE = prose(WITHHELD.map((c) => c.noun));
const SEARCH_PLACEHOLDER = SEARCHABLE_DATA.length > 0
  ? `Search ${prose(['pages', 'features', ...SEARCHABLE_DATA.map((c) => c.noun)])}...`
  : 'Search pages and features...';
const WITHHELD_TITLE = WITHHELD.length === DATA_CATEGORIES.length
  ? 'Pages and features only here.'
  : 'Some search categories are live-only here.';

/* The bell counts two things and they belong to two different domains, so it can be half blind.
   Named here rather than derived in the component for the same reason as above. */
const NOTIF_BLIND = [
  ...(SEARCHABLE.listings ? [] : ['Pending verifications']),
  ...(SEARCHABLE.tickets ? [] : ['New service requests']),
];

/** Stands in for `rawDb()` where every category that would have read it is withheld. */
const NO_DB = {};

const NAV_INDEX_FULL = [
  { label: 'Dashboard', keywords: 'dashboard home overview', path: '/admin', icon: LayoutDashboard, flag: null },
  { label: 'Analytics', keywords: 'analytics stats chart graph', path: '/admin/analytics', icon: BarChart3, flag: 'analytics' },
  { label: 'Properties', keywords: 'properties listings homes flats apartments manage', path: '/admin/properties', icon: Building2, flag: null },
  { label: 'Users', keywords: 'users people accounts customers owners tenants members', path: '/admin/users', icon: Users, flag: null },
  { label: 'Services', keywords: 'services requests tickets packers movers legal interior valuation rent agreement home loans finance', path: '/admin/services', icon: Wrench, flag: null },
  { label: 'Enquiries', keywords: 'enquiries messages inbox contact leads', path: '/admin/enquiries', icon: MessageSquare, flag: null },
  { label: 'Finance', keywords: 'finance billing payments revenue invoices subscriptions money', path: '/admin/finance', icon: IndianRupee, flag: 'finance' },
  { label: 'Content', keywords: 'content cms pages blog posts manage text', path: '/admin/content', icon: FileText, flag: null },
  { label: 'Reports', keywords: 'reports flagged abuse spam moderation', path: '/admin/reports', icon: Flag, flag: 'reports' },
  { label: 'Support', keywords: 'support help tickets complaints issues', path: '/admin/support', icon: LifeBuoy, flag: 'support' },
  { label: 'Flatmates', keywords: 'flatmates roommate matching seekers moderation', path: '/ops/flatmate-review', icon: Users, flag: 'flatmates' },
  { label: 'Societies', keywords: 'societies society claim resident verification rwa committee gated community buildings', path: '/admin/societies', icon: Building2, flag: null },
  { label: 'Localities', keywords: 'localities locality area neighbourhood neighborhood registry pending mint verify curated community pune', path: '/admin/localities', icon: Compass, flag: null },
  { label: 'Settings', keywords: 'settings configuration preferences site general email notifications sms seo', path: '/admin/settings', icon: Settings, flag: null },
  { label: 'Referrals (Ops)', keywords: 'referrals ops refer bonus', path: '/ops/referrals', icon: Gift, flag: null },
  { label: 'Help & Runbooks', keywords: 'help runbook runbooks docs documentation guide guides knowledge base handbook playbook ops internal how to', path: '/help/c/ops-playbook', icon: BookOpen, flag: null },
];

const FEATURES_INDEX = [
  { label: 'Traffic', keywords: 'traffic visits pageviews sessions visitors', path: '/admin/analytics?tab=traffic', parent: 'Analytics', flag: 'analytics.traffic' },
  { label: 'Engagement', keywords: 'engagement session duration bounce rate top pages', path: '/admin/analytics?tab=engagement', parent: 'Analytics', flag: 'analytics.engagement' },
  { label: 'Anonymous Surfers', keywords: 'anonymous surfers non-registered visitors tracking', path: '/admin/analytics?tab=surfers', parent: 'Analytics', flag: 'analytics.anonymous' },
  { label: 'Geography', keywords: 'geography locality area demand listings rates pune', path: '/admin/analytics?tab=geography', parent: 'Analytics', flag: 'analytics.geography' },
  { label: 'Supply Gap', keywords: 'supply gap demand market opportunity underserved', path: '/admin/analytics?tab=supply-gap', parent: 'Analytics', flag: 'analytics.supplyGap' },
  { label: 'City Requests', keywords: 'city request expansion request your city geographic demand waitlist new city', path: '/admin/analytics?tab=supply-gap', parent: 'Analytics', flag: 'analytics.supplyGap' },
  { label: 'Pricing Intelligence', keywords: 'pricing market rate comparison sqft intelligence', path: '/admin/analytics?tab=pricing', parent: 'Analytics', flag: 'analytics.pricing' },
  { label: 'SLA Compliance', keywords: 'sla compliance service level response time', path: '/admin/analytics?tab=sla', parent: 'Analytics', flag: 'analytics.sla' },
  { label: 'Seasonal Patterns', keywords: 'seasonal demand trends monsoon summer pune', path: '/admin/analytics?tab=seasonal', parent: 'Analytics', flag: 'analytics.seasonal' },

  { label: 'All Listings', keywords: 'all listings approved active', path: '/admin/properties?tab=all', parent: 'Properties', flag: null },
  { label: 'Verification Queue', keywords: 'verification queue pending review approve reject', path: '/admin/properties?tab=verify', parent: 'Properties', flag: null },
  { label: 'Needs Follow-up', keywords: 'follow-up followup stale awaiting', path: '/admin/properties?tab=followup', parent: 'Properties', flag: null },
  { label: 'Staff Posted', keywords: 'staff posted on behalf', path: '/admin/properties?tab=staff', parent: 'Properties', flag: null },
  { label: 'Flagged Listings', keywords: 'flagged reported abuse', path: '/admin/properties?tab=flagged', parent: 'Properties', flag: null },
  { label: 'Featured Listings', keywords: 'featured premium spotlight promoted', path: '/admin/properties?tab=featured', parent: 'Properties', flag: null },
  { label: 'Sales Pipeline', keywords: 'pipeline sales conversion deal', path: '/admin/properties?tab=pipeline', parent: 'Properties', flag: null },

  { label: 'Enquiries List', keywords: 'enquiries list leads inbox messages contact', path: '/admin/enquiries?tab=enquiries', parent: 'Enquiries', flag: null },
  { label: 'Site Visits', keywords: 'visits site scheduling calendar viewing property', path: '/admin/enquiries?tab=visits', parent: 'Enquiries', flag: 'enquiries.visits' },
  { label: 'Deals', keywords: 'deals closed gmv transactions negotiation', path: '/admin/enquiries?tab=deals', parent: 'Enquiries', flag: 'enquiries.deals' },
  { label: 'Conversion Funnel', keywords: 'funnel conversion pipeline enquiry visit deal time drop-off', path: '/admin/enquiries?tab=funnel', parent: 'Enquiries', flag: null },

  { label: 'Revenue Charts', keywords: 'revenue charts mrr subscriptions services featured', path: '/admin/finance', parent: 'Finance', flag: 'finance.charts' },
  { label: 'Transactions', keywords: 'transactions ledger payments billing invoices', path: '/admin/finance', parent: 'Finance', flag: 'finance.transactions' },
  { label: 'Financial Models', keywords: 'models subscription payout calculations', path: '/admin/finance', parent: 'Finance', flag: 'finance.models' },
  { label: 'Rent-Pay Tracking', keywords: 'rent pay payment fee tracking tenant', path: '/admin/finance', parent: 'Finance', flag: 'finance.rentPay' },

  { label: 'Banners', keywords: 'banners promotional homepage carousel', path: '/admin/content?tab=banners', parent: 'Content', flag: 'content.banners' },
  { label: 'FAQs', keywords: 'faqs frequently asked questions help', path: '/admin/content?tab=faqs', parent: 'Content', flag: 'content.faqs' },
  { label: 'Announcements', keywords: 'announcements notifications alerts', path: '/admin/content?tab=announcements', parent: 'Content', flag: 'content.announcements' },
  { label: 'Reviews Moderation', keywords: 'reviews moderation feedback ratings', path: '/admin/content?tab=reviews', parent: 'Content', flag: 'content.reviews' },

  { label: 'General Settings', keywords: 'general site email notifications sms configuration', path: '/admin/settings?tab=general', parent: 'Settings', flag: null },
  { label: 'Fee Configuration', keywords: 'fees pricing commission brokerage charges', path: '/admin/settings?tab=fees', parent: 'Settings', flag: null },
  { label: 'Feature Flags', keywords: 'feature flags toggles enable disable modules', path: '/admin/settings?tab=flags', parent: 'Settings', flag: null },
  { label: 'Audit Log', keywords: 'audit log history actions trail who changed', path: '/admin/settings?tab=audit', parent: 'Settings', flag: null },

  { label: 'Reported Properties', keywords: 'reported abuse fake fraud listings', path: '/admin/reports?tab=listings', parent: 'Reports', flag: 'reports' },
  { label: 'Reported Users', keywords: 'reported impersonation abuse spam', path: '/admin/reports?tab=users', parent: 'Reports', flag: 'reports' },

  { label: 'Host Verification', keywords: 'verification tenant owner badge flatmate agreement', path: '/ops/flatmate-review', parent: 'Flatmates', flag: 'flatmates' },
  { label: 'Flatmate Moderation', keywords: 'seekers rooms groups flatmate share roommate posts publish', path: '/ops/flatmate-review', parent: 'Flatmates', flag: 'flatmates' },
  { label: 'Group Applications', keywords: 'applications join group flatmate', path: '/ops/flatmate-review', parent: 'Flatmates', flag: 'flatmates' },

  { label: 'Society Claims', keywords: 'society claims rwa committee onboard manage', path: '/admin/societies?tab=claims', parent: 'Societies', flag: null },
  { label: 'Resident Verifications', keywords: 'resident verification proof live here badge', path: '/admin/societies?tab=residents', parent: 'Societies', flag: null },
  { label: 'Society Directory', keywords: 'society directory catalogue edit overlay maintenance', path: '/admin/societies?tab=directory', parent: 'Societies', flag: null },

  { label: 'Pending Localities', keywords: 'pending localities review verify promote minted community area', path: '/admin/localities?tab=pending', parent: 'Localities', flag: null },
  { label: 'Locality Directory', keywords: 'locality directory registry curated community areas', path: '/admin/localities?tab=directory', parent: 'Localities', flag: null },

  /* Three Dashboard entries stood here — Smart Alerts, SLA Health and Daily Scorecard. All three
     jumped to `/admin` to land on a panel that was generated in the browser from a seeded PRNG, and
     the panels have been removed rather than repointed (no route produces them; see the comment in
     AdminDashboard.jsx and the rows in tasks/DECISIONS-NEEDED.md). A palette entry that navigates
     somewhere real and then finds nothing is worse than no entry, so they go with the panels. The
     `dash.*` flags they were gated on stay in AdminFlagsContext for whoever restores the work. */

  { label: 'Staff KPIs', keywords: 'staff kpi performance metrics summary', path: '/admin/staff-activity', parent: 'Staff Activity', flag: 'staffActivity.kpis' },
  { label: 'Staff Leaderboard', keywords: 'leaderboard ranking staff top performer', path: '/admin/staff-activity', parent: 'Staff Activity', flag: 'staffActivity.leaderboard' },

  { label: 'Team Routing', keywords: 'team routing assign tickets', path: '/admin/services', parent: 'Services', flag: 'services.teamRouting' },
  { label: 'Priority Levels', keywords: 'priority high medium low urgent tickets', path: '/admin/services', parent: 'Services', flag: 'services.priority' },
  { label: 'Staff Assignment', keywords: 'staff assignment assign tickets individual', path: '/admin/services', parent: 'Services', flag: 'services.staffAssignment' },

  /* Staff runbooks. Indexed here so the answer to "what is the SLA on this queue?"
     is one ⌘K away from the queue itself, rather than something you have to know
     the help centre exists to find. These are the same articles gated by role in
     lib/help.js — only internal accounts can reach the back-office at all. */
  { label: 'Verification SLAs', keywords: 'sla slas turnaround target verification kyc queue breach escalation runbook internal ops deadline', path: '/help/a/verification-sla', parent: 'Runbooks', flag: null },
  { label: 'Ticket Handling & Escalation', keywords: 'ticket handling escalation priority p0 p1 p2 p3 support refund approval ladder runbook internal ops', path: '/help/a/ticket-escalation', parent: 'Runbooks', flag: null },
  { label: 'Ops Playbook', keywords: 'ops playbook runbook internal staff procedures guide index', path: '/help/c/ops-playbook', parent: 'Runbooks', flag: null },
  { label: 'Product Changelog', keywords: 'changelog release notes shipped whats new version updates', path: '/help/changelog', parent: 'Runbooks', flag: null },
];

function useOutside(refs, onOutside, active) {
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (e) => {
      if (refs.every((r) => !(r.current && r.current.contains(e.target)))) onOutside();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [refs, onOutside, active]);
}

/* `all` and `features` are always offered; a data category only earns a chip where its rows are
   still real. A chip whose count is structurally zero is an invitation to conclude the system is
   empty. */
const FILTER_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'features', label: 'Features' },
  ...DATA_CATEGORIES.filter((c) => SEARCHABLE[c.key]).map((c) => ({ key: c.key, label: c.chip })),
];

function StatusPill({ status, type }) {
  const colors = {
    approved: 'bg-emerald-500/15 text-emerald-300',
    pending: 'bg-amber-500/15 text-amber-300',
    flagged: 'bg-rose-500/15 text-rose-300',
    new: 'bg-amber-500/15 text-amber-300',
    responded: 'bg-emerald-500/15 text-emerald-300',
    closed: 'bg-emerald-500/15 text-emerald-300',
    done: 'bg-emerald-500/15 text-emerald-300',
    in_progress: 'bg-sky-500/15 text-sky-300',
  };
  return (
    <span className={'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ' + (colors[status] || 'bg-white/10 text-gray-400')}>
      {status}
    </span>
  );
}

export default function AdminTopbarTools() {
  const navigate = useNavigate();
  const { adminFlags, tabEnabled, optionEnabled } = useAdminFlags();
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const searchRef = useRef(null);
  const notifRef = useRef(null);

  const NAV_INDEX = useMemo(
    () => NAV_INDEX_FULL.filter((item) => !item.flag || tabEnabled(item.flag)),
    [adminFlags.tab, tabEnabled],
  );

  const FEATURES = useMemo(
    () => FEATURES_INDEX.filter((f) => !f.flag || optionEnabled(f.flag)),
    [optionEnabled],
  );

  useOutside([searchRef], () => { setSearchOpen(false); setQ(''); setFilter('all'); }, searchOpen);
  useOutside([notifRef], () => setNotifOpen(false), notifOpen);

  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setSearchOpen(false); setNotifOpen(false); setQ(''); setFilter('all'); inputRef.current?.blur(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); inputRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return null;
    /* Not read at all where every category that would consume it is withheld — so on a fully live
       build this component touches the mock store zero times, rather than reading it and discarding
       the answer. */
    const db = ANY_DATA_SEARCHABLE ? rawDb() : NO_DB;
    const wants = (key) => (filter === 'all' || filter === key) && SEARCHABLE[key];

    const allPages = (filter === 'all' || filter === 'features')
      ? NAV_INDEX.filter((p) => (p.label + ' ' + p.keywords).toLowerCase().includes(term))
      : [];
    const allFeatures = (filter === 'all' || filter === 'features')
      ? FEATURES.filter((f) => (f.label + ' ' + f.keywords + ' ' + f.parent).toLowerCase().includes(term))
      : [];
    const allListings = wants('listings')
      ? (db.listings || []).filter((l) => (l.title + ' ' + l.locality + ' ' + l.owner + ' ' + l.id + ' ' + (l.deal || '')).toLowerCase().includes(term))
      : [];
    const allUsers = wants('users')
      ? (db.users || []).filter((u) => (u.name + ' ' + u.mobile + ' ' + u.role).toLowerCase().includes(term))
      : [];
    const allTickets = wants('tickets')
      ? (db.tickets || []).filter((t) => (t.service + ' ' + t.customer + ' ' + t.id + ' ' + (t.detail || '') + ' ' + (t.team || '')).toLowerCase().includes(term))
      : [];
    const allEnquiries = wants('enquiries')
      ? (db.enquiries || []).filter((e) => (e.listing + ' ' + e.customer + ' ' + e.mobile + ' ' + e.id + ' ' + (e.kind || '')).toLowerCase().includes(term))
      : [];
    const allDeals = wants('deals')
      ? (db.deals || []).filter((d) => (d.listing + ' ' + d.id + ' ' + (d.deal || '')).toLowerCase().includes(term))
      : [];

    const totalAll = allPages.length + allFeatures.length + allListings.length + allUsers.length + allTickets.length + allEnquiries.length + allDeals.length;
    return {
      pages: allPages.slice(0, 4),
      features: allFeatures.slice(0, 8),
      listings: allListings.slice(0, 6),
      users: allUsers.slice(0, 6),
      tickets: allTickets.slice(0, 6),
      enquiries: allEnquiries.slice(0, 6),
      deals: allDeals.slice(0, 6),
      total: totalAll,
      counts: { pages: allPages.length, features: allFeatures.length, listings: allListings.length, users: allUsers.length, tickets: allTickets.length, enquiries: allEnquiries.length, deals: allDeals.length },
    };
  }, [q, filter, NAV_INDEX, FEATURES]);

  const notif = useMemo(() => {
    /* Same origin, same problem, same gate: these two counts were read off `db.json` rows on every
       deployment. A red dot claiming fifteen listings are waiting is a worse artefact than the
       palette's, because nobody types anything to summon it. */
    const db = (SEARCHABLE.listings || SEARCHABLE.tickets) ? rawDb() : NO_DB;
    const pending = SEARCHABLE.listings ? (db.listings || []).filter((l) => l.status === 'pending') : [];
    const newTickets = SEARCHABLE.tickets ? (db.tickets || []).filter((t) => t.status === 'new') : [];
    return { pending, newTickets, total: pending.length + newTickets.length };
  }, [notifOpen]);

  const go = (path) => { setSearchOpen(false); setNotifOpen(false); setQ(''); navigate(path); };
  const roleIcon = (role) => (role === 'staff' ? Wrench : role === 'owner' ? ShieldCheck : User);

  return (
    <div className="flex items-center gap-3 flex-1 ml-2">
      {/* Global search */}
      <div className="relative flex-1 max-w-md" ref={searchRef}>
        <div className="hidden items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2 sm:flex hover:border-white/20 focus-within:border-teal-500/40 focus-within:bg-white/[0.08] transition-all">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSearchOpen(e.target.value.trim().length >= 2); }}
            onFocus={() => { if (q.trim().length >= 2) setSearchOpen(true); }}
            placeholder={SEARCH_PLACEHOLDER}
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
            aria-label="Global search"
          />
          <kbd className="hidden lg:inline-flex items-center rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">Ctrl+K</kbd>
        </div>
          <button onClick={() => setSearchOpen((o) => !o)} className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-gray-300 hover:text-white sm:hidden" aria-label="Search">
          <Search className="h-4 w-4" />
        </button>

        {searchOpen && results && (
          <div data-testid="admin-palette" className="absolute left-0 z-[60] mt-2 w-[480px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-white/10 bg-ink-2 shadow-2xl flex flex-col max-sm:fixed max-sm:inset-x-3 max-sm:top-14 max-sm:mt-0 max-sm:w-auto max-sm:max-w-none" style={{ maxHeight: '75vh' }}>
            <div className="flex items-center gap-1 px-3 py-2.5 border-b border-white/10 shrink-0 flex-wrap">
              {FILTER_CHIPS.map((c) => {
                const count = c.key === 'all' ? results.total : c.key === 'features' ? (results.counts.pages + results.counts.features) : (results.counts[c.key] || 0);
                return (
                  <button key={c.key} onClick={() => setFilter(c.key)} className={'whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ' + (filter === c.key ? 'bg-teal-500/20 text-teal-300' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200')}>
                    {c.label}{count > 0 ? ' (' + count + ')' : ''}
                  </button>
                );
              })}
              <span className="ml-auto text-[11px] text-gray-500 tabular-nums shrink-0">{results.total} found</span>
            </div>

            <div className="overflow-y-auto p-2 flex-1">
              {results.total === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-500">No matches found</div>
              ) : (
                <>
                  {results.pages.length > 0 && (
                    <>
                      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Pages</div>
                      {results.pages.map((p) => { const PI = p.icon; return (
                        <button key={p.path} onClick={() => go(p.path)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-500/15 text-teal-300"><PI className="h-4 w-4" /></span>
                          <span className="min-w-0"><span className="block truncate text-sm text-white">{p.label}</span><span className="block truncate text-xs text-gray-400">{p.path}</span></span>
                        </button>
                      ); })}
                    </>
                  )}
                  {results.features.length > 0 && (
                    <>
                      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Features ({results.features.length})</div>
                      {results.features.map((f) => (
                        <button key={f.path + f.label} onClick={() => go(f.path)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500/15 text-violet-300"><Compass className="h-4 w-4" /></span>
                          <span className="min-w-0"><span className="block truncate text-sm text-white">{f.label}</span><span className="block truncate text-xs text-gray-400">{f.parent} &middot; {f.path}</span></span>
                        </button>
                      ))}
                    </>
                  )}
                  {results.listings.length > 0 && (
                    <>
                      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Listings ({results.listings.length})</div>
                      {results.listings.map((l) => (
                        <button key={l.id} onClick={() => go('/admin/properties?review=' + l.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-500/15 text-teal-300"><Building2 className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{l.title}</span><span className="block truncate text-xs text-gray-400">{l.locality} &middot; {l.owner}</span></span>
                          <StatusPill status={l.status} />
                        </button>
                      ))}
                    </>
                  )}
                  {results.users.length > 0 && (
                    <>
                      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">People ({results.users.length})</div>
                      {results.users.map((u) => { const RI = roleIcon(u.role); return (
                        <button key={u.id} onClick={() => go('/admin/users')} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300"><RI className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{u.name}</span><span className="block truncate text-xs text-gray-400">{u.role} &middot; {u.mobile}</span></span>
                          {u.verified && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-teal-400" />}
                        </button>
                      ); })}
                    </>
                  )}
                  {results.enquiries.length > 0 && (
                    <>
                      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Enquiries ({results.enquiries.length})</div>
                      {results.enquiries.map((e) => (
                        <button key={e.id} onClick={() => go('/admin/enquiries')} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-500/15 text-sky-300"><Mail className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{e.customer}</span><span className="block truncate text-xs text-gray-400">{e.listing} &middot; {e.kind}</span></span>
                          <StatusPill status={e.status} />
                        </button>
                      ))}
                    </>
                  )}
                  {results.deals.length > 0 && (
                    <>
                      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Deals ({results.deals.length})</div>
                      {results.deals.map((d) => (
                        <button key={d.id} onClick={() => go('/admin/enquiries')} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300"><Handshake className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{d.listing}</span><span className="block truncate text-xs text-gray-400">{d.deal} &middot; {fmtINR(d.value)}</span></span>
                          <StatusPill status={d.status} />
                        </button>
                      ))}
                    </>
                  )}
                  {results.tickets.length > 0 && (
                    <>
                      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Services ({results.tickets.length})</div>
                      {results.tickets.map((t) => (
                        <button key={t.id} onClick={() => go('/admin/services')} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500/15 text-amber-300"><Wrench className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{t.service}</span><span className="block truncate text-xs text-gray-400">{t.customer} &middot; {t.team}</span></span>
                          <StatusPill status={t.status} />
                        </button>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
            {/* Outside the scroll area on purpose: an operator who typed a colleague's name and got
                "No matches found" has to be able to read why without scrolling to it. Says what is
                not being searched and what would have to exist for it to be — not "an error
                occurred", which is nothing anyone can act on. */}
            {WITHHELD.length > 0 && (
              <div className="shrink-0 border-t border-white/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200/80">
                <span className="font-semibold text-amber-200">{WITHHELD_TITLE}</span>{' '}
                Searching {WITHHELD_PROSE} would need an admin search API that does not exist yet.
                Until it does, this palette does not look for them rather than answer from demo data
                the server has never had.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="relative" ref={notifRef}>
        {/* tap-extend rather than a bigger square: this is a 36px bordered chip in a
            topbar whose height is set by the search field next to it, and painting it
            44px would make it the loudest thing in the bar. `relative` is already
            here for the unread badge, so the pseudo has its context. */}
        <button onClick={() => setNotifOpen((o) => !o)} className="tap-extend relative grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-gray-300 hover:text-white" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {notif.total > 0 && <span data-testid="notif-unread-dot" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-400" />}
        </button>
        {notifOpen && (
          <div data-testid="admin-notifications" className="absolute right-0 z-40 mt-2 w-80 overflow-y-auto rounded-2xl border border-white/10 bg-ink-2 p-2 shadow-2xl" style={{ maxHeight: '70vh' }}>
            {notif.total === 0 && NOTIF_BLIND.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-gray-500">All caught up.</div>
            ) : (
              <>
                {notif.pending.length > 0 && (
                  <>
                    <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Pending verification ({notif.pending.length})</div>
                    {notif.pending.slice(0, 5).map((l) => (
                      <button key={l.id} onClick={() => go('/admin/properties')} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-500/15 text-teal-300"><Building2 className="h-4 w-4" /></span>
                        <span className="min-w-0"><span className="block truncate text-sm text-white">{l.title}</span><span className="block truncate text-xs text-gray-400">{l.locality} &middot; {l.owner}</span></span>
                      </button>
                    ))}
                  </>
                )}
                {notif.newTickets.length > 0 && (
                  <>
                    <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">New service requests ({notif.newTickets.length})</div>
                    {notif.newTickets.slice(0, 5).map((t) => (
                      <button key={t.id} onClick={() => go('/admin/services')} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500/15 text-amber-300"><Wrench className="h-4 w-4" /></span>
                        <span className="min-w-0"><span className="block truncate text-sm text-white">{t.service}</span><span className="block truncate text-xs text-gray-400">{t.customer} &middot; {t.mobile}</span></span>
                      </button>
                    ))}
                  </>
                )}
                {NOTIF_BLIND.length > 0 && (
                  /* Not "All caught up." — that is the sentence this bell used to print once its
                     fixture rows ran out, and a console that agrees with you is more dangerous than
                     one that errors (D231). It names the two queues instead, because those are the
                     record while nothing counts them for you. */
                  <div className={'px-3 py-3 text-[11px] leading-relaxed text-amber-200/80' + (notif.total > 0 ? ' mt-1 border-t border-white/10' : '')}>
                    <p className="text-xs font-semibold text-amber-200">
                      {NOTIF_BLIND.length === 2 ? 'This bell is not counting anything here.' : 'Half of this bell is dark here.'}
                    </p>
                    <p className="mt-1">
                      {prose(NOTIF_BLIND)} {NOTIF_BLIND.length === 2 ? 'were' : 'was'} counted from
                      the browser&rsquo;s demo data, not from the system you are administering, so the
                      count is switched off rather than made up. Open Properties and Services — those
                      queues are the record.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
