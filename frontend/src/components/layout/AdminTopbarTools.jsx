import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, Bell, Building2, User, Wrench, ShieldCheck, LayoutDashboard, BarChart3, MessageSquare, FileText, Flag, LifeBuoy, Users, Settings, IndianRupee, Gift, Compass, BookOpen } from 'lucide-react';
import { lookupForModeration } from '../../services/propertyService.js';
import { listUsers } from '../../services/usersService.js';
import { adminBell } from '../../services/analyticsService.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useHelpTree } from '../../lib/useHelp.js';
import { useNotifications } from '../../context/NotificationContext.jsx';
import { listNotifications, markAllRead, markRead } from '../../services/notificationService.js';
import { safeNotificationLink } from '../notifications/notificationModel.js';
import { SERVICE_DESKS, canOpenPath, hasPermission, portalPath, runbooksFor, ticketPath } from '../../lib/adminModules.js';
/** Rows shown per data category. The chip beside it carries the size of the whole match. */

const RESULT_CAP = 6;
/** Rows shown per queue in the bell, on the same split: heading counts, list samples. */

/** One request per pause in typing rather than one per keystroke. */

const DEBOUNCE_MS = 200;
const BELL_REFRESH_MS = 90_000;
/** "a", "a and b", "a, b and c" — so the notices below read as sentences rather than lists. */

const prose = (words) =>
  words.length < 2 ? (words[0] || '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

const SEARCH_PLACEHOLDER = 'Search pages, features, listings and people...';
/* `term` is what the rows in here answer, which is not always what is in the field: it is how the render knows
   whether it is holding this search's results or the previous one's. */

const NO_RESULTS = { term: '', listings: [], listingsTotal: 0, users: [], usersTotal: 0, failed: [] };
const NOTHING = { items: [], total: 0 };

const NAV_INDEX_FULL = [
  { label: 'Dashboard', keywords: 'dashboard home overview', path: '/admin', icon: LayoutDashboard, flag: null },
  { label: 'Analytics', keywords: 'analytics stats chart graph', path: '/admin/analytics', icon: BarChart3, flag: 'analytics' },
  { label: 'Properties', keywords: 'properties listings homes flats apartments manage', path: '/admin/properties', icon: Building2, flag: null },
  { label: 'Users', keywords: 'users people accounts customers owners tenants members', path: '/admin/users', icon: Users, flag: null },
  ...SERVICE_DESKS.map((d) => ({ label: d.label, keywords: `services desk requests tickets ${d.label.toLowerCase()}`, path: d.path, icon: d.icon, flag: null })),
  { label: 'Enquiries', keywords: 'enquiries messages inbox contact leads', path: '/admin/enquiries', icon: MessageSquare, flag: null },
  { label: 'Finance', keywords: 'finance billing payments revenue invoices subscriptions money', path: '/admin/finance', icon: IndianRupee, flag: 'finance' },
  { label: 'Content', keywords: 'content cms pages blog posts manage text', path: '/admin/content', icon: FileText, flag: null },
  { label: 'Reports', keywords: 'reports flagged abuse spam moderation', path: '/admin/reports', icon: Flag, flag: 'reports' },
  { label: 'Support', keywords: 'support help tickets complaints issues', path: '/admin/support', icon: LifeBuoy, flag: 'support' },
  { label: 'Flatmates', keywords: 'flatmates roommate matching seekers moderation', path: '/admin/flatmates', icon: Users, flag: 'flatmates' },
  { label: 'Societies', keywords: 'societies society merge duplicate buildings', path: '/admin/societies', icon: Building2, flag: null },
  { label: 'Localities', keywords: 'localities locality area neighbourhood neighborhood registry community pune', path: '/admin/localities', icon: Compass, flag: null },
  { label: 'Settings', keywords: 'settings configuration preferences site general email notifications sms seo', path: '/admin/settings', icon: Settings, flag: null },
  { label: 'Integrations', keywords: 'integrations email whatsapp otp payments cashfree zoho webhook delivery failures providers', path: '/admin/integrations', icon: Settings, flag: null },
  { label: 'Referrals', keywords: 'referrals ops refer bonus', path: '/admin/referrals', icon: Gift, flag: null },
  { label: 'Runbooks', keywords: 'help runbook runbooks docs documentation guide guides knowledge base handbook playbook ops internal how to checklist', path: '/admin/runbooks', icon: BookOpen, flag: null },
];

const FEATURES_INDEX = [
  { label: 'Traffic', keywords: 'traffic visits pageviews sessions visitors', path: '/admin/analytics?tab=traffic', parent: 'Analytics', flag: 'analytics' },
  { label: 'Engagement', keywords: 'engagement session duration bounce rate top pages', path: '/admin/analytics?tab=engagement', parent: 'Analytics', flag: 'analytics' },
  { label: 'Funnel', keywords: 'funnel conversion listings approved contacts visits deals closed', path: '/admin/analytics?tab=funnel', parent: 'Analytics', flag: 'analytics' },
  { label: 'Supply Gap', keywords: 'supply gap demand market opportunity underserved locality area', path: '/admin/analytics?tab=supply-gap', parent: 'Analytics', flag: 'analytics' },
  { label: 'City Requests', keywords: 'city request expansion request your city geographic demand waitlist new city', path: '/admin/analytics?tab=supply-gap', parent: 'Analytics', flag: 'analytics' },
  { label: 'Pricing Intelligence', keywords: 'pricing market rate comparison sqft intelligence', path: '/admin/analytics?tab=pricing', parent: 'Analytics', flag: 'analytics' },
  { label: 'SLA Compliance', keywords: 'sla compliance service level response time ticket pickup delivery concierge turnaround', path: '/admin/analytics?tab=sla', parent: 'Analytics', flag: 'analytics' },

  { label: 'To Verify', keywords: 'verification queue pending review approve reject', path: '/admin/properties?tab=verify', parent: 'Properties', flag: null },
  { label: 'Re-checks', keywords: 'recheck re-check edited live price furnishing possession', path: '/admin/properties?tab=recheck', parent: 'Properties', flag: null },
  { label: 'Badge Requests', keywords: 'verified badge ownership documents vault', path: '/admin/properties?tab=badge', parent: 'Properties', flag: null },
  { label: 'Needs Follow-up', keywords: 'follow-up followup stale unconfirmed nudge', path: '/admin/properties?tab=followup', parent: 'Properties', flag: null },
  { label: 'Flagged Listings', keywords: 'flagged reported abuse', path: '/admin/properties?tab=flagged', parent: 'Properties', flag: null },
  { label: 'All Listings', keywords: 'all listings approved active staff posted featured', path: '/admin/properties?tab=all', parent: 'Properties', flag: null },

  { label: 'Enquiries List', keywords: 'enquiries list leads inbox messages contact', path: '/admin/enquiries?tab=enquiries', parent: 'Enquiries', flag: null },
  { label: 'Site Visits', keywords: 'visits site scheduling calendar viewing property', path: '/admin/enquiries?tab=visits', parent: 'Enquiries', flag: null },
  { label: 'Deals', keywords: 'deals closed gmv transactions negotiation', path: '/admin/enquiries?tab=deals', parent: 'Enquiries', flag: null },
  { label: 'Conversion Funnel', keywords: 'funnel conversion pipeline enquiry visit deal time drop-off', path: '/admin/enquiries?tab=funnel', parent: 'Enquiries', flag: null },

  { label: 'Revenue Charts', keywords: 'revenue charts mrr subscriptions services featured', path: '/admin/finance', parent: 'Finance', flag: 'finance' },
  { label: 'Transactions', keywords: 'transactions ledger payments billing invoices', path: '/admin/finance', parent: 'Finance', flag: 'finance' },
  { label: 'Financial Models', keywords: 'models subscription payout calculations', path: '/admin/finance', parent: 'Finance', flag: 'finance' },

  { label: 'FAQs', keywords: 'faqs frequently asked questions help', path: '/admin/content', parent: 'Content', flag: 'content.enabled' },

  { label: 'General Settings', keywords: 'general site email notifications sms configuration', path: '/admin/settings?tab=general', parent: 'Settings', flag: null },
  { label: 'Fee Configuration', keywords: 'fees pricing commission brokerage charges', path: '/admin/settings?tab=fees', parent: 'Settings', flag: null },
  { label: 'Feature Flags', keywords: 'feature flags toggles enable disable modules', path: '/admin/settings?tab=flags', parent: 'Settings', flag: null },
  { label: 'Activity Log', keywords: 'audit log history actions trail who changed staff activity', path: '/admin/staff-activity?tab=log', parent: 'Team Activity', flag: null },

  { label: 'Reported Properties', keywords: 'reported abuse fake fraud listings', path: '/admin/reports?tab=listings', parent: 'Reports', flag: 'reports' },
  { label: 'Reported Users', keywords: 'reported impersonation abuse spam', path: '/admin/reports?tab=users', parent: 'Reports', flag: 'reports' },
  { label: 'Reviews Moderation', keywords: 'reviews moderation feedback ratings approve reject', path: '/admin/reports?tab=reviews', parent: 'Reports', flag: 'reports' },

  { label: 'Host Verification', keywords: 'verification tenant owner badge flatmate agreement', path: '/admin/flatmates', parent: 'Flatmates', flag: 'flatmates' },
  { label: 'Flatmate Moderation', keywords: 'seekers rooms groups flatmate share roommate posts publish', path: '/admin/flatmates', parent: 'Flatmates', flag: 'flatmates' },
  { label: 'Group Applications', keywords: 'applications join group flatmate', path: '/admin/flatmates', parent: 'Flatmates', flag: 'flatmates' },

  { label: 'Society Candidates', keywords: 'society candidates merge duplicate minted community', path: '/admin/societies?tab=candidates', parent: 'Societies', flag: null },
  { label: 'Society Directory', keywords: 'society directory catalogue edit overlay maintenance', path: '/admin/societies?tab=directory', parent: 'Societies', flag: null },

  { label: 'Locality Directory', keywords: 'locality directory registry community areas retired active', path: '/admin/localities', parent: 'Localities', flag: null },
  /* Three Dashboard entries stood here — Smart Alerts, SLA Health and Daily Scorecard. */

  { label: 'Team Performance', keywords: 'staff kpi performance metrics summary leaderboard turnaround', path: '/admin/staff-activity?tab=performance', parent: 'Team Activity', flag: null },

  { label: 'Priority Levels', keywords: 'priority high medium low urgent tickets', path: '/admin/home-loans', parent: 'Home Loans', flag: 'services.enabled' },
  { label: 'Staff Assignment', keywords: 'staff assignment assign tickets individual', path: '/admin/home-loans', parent: 'Home Loans', flag: 'services.enabled' },

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
/* Fixed, because all four are answerable on every deployment now. */

const FILTER_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'features', label: 'Features' },
  { key: 'listings', label: 'Listings' },
  { key: 'users', label: 'People' },
];
/** Listing moderation statuses, which are the only ones this palette renders now. */

function StatusPill({ status }) {
  const colors = {
    approved: 'bg-emerald-500/15 text-emerald-300',
    pending: 'bg-amber-500/15 text-amber-300',
    flagged: 'bg-rose-500/15 text-rose-300',
    archived: 'bg-white/10 text-gray-400',
  };
  return (
    <span className={'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ' + (colors[status] || 'bg-white/10 text-gray-400')}>
      {status}
    </span>
  );
}

// A section the caller may read but the server left out is dark, never zero; a failed read darkens all of them.
function toNotif(bell, canReadProperties, canReadTickets) {
  const pending = bell?.pendingListings;
  const open = bell?.openTickets;
  const replied = bell?.ownerReplies;
  return {
    pending: pending?.items || [],
    pendingTotal: pending?.total || 0,
    open: open?.items || [],
    openTotal: open?.total || 0,
    replied: replied?.items || [],
    repliedTotal: replied?.total || 0,
    blind: [
      ...(canReadProperties && !pending ? ['Pending verifications'] : []),
      ...(canReadTickets && !open ? ['Open service requests'] : []),
      ...(canReadProperties && !replied ? ['Owner replies'] : []),
    ],
    total: (pending?.total || 0) + (open?.total || 0) + (replied?.total || 0),
  };
}
export default function AdminTopbarTools() {
  const navigate = useNavigate();
  const { unread, refresh: refreshUnread } = useNotifications();
  const { tabEnabled, optionEnabled } = useAdminFlags();
  const { user } = useAuth();
  const canReadProperties = hasPermission(user, 'properties:read');
  const canReadUsers = hasPermission(user, 'users:read');
  const canReadTickets = hasPermission(user, 'tickets:read');
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [phoneSearch, setPhoneSearch] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const searchRef = useRef(null);
  const notifRef = useRef(null);

  const NAV_INDEX = useMemo(
    () => NAV_INDEX_FULL.filter((item) => (!item.flag || tabEnabled(item.flag)) && canOpenPath(user, item.path)),
    [tabEnabled, user],
  );

  const { articles } = useHelpTree();
  const FEATURES = useMemo(() => {
    const runbooks = runbooksFor(articles, user)
      .map((a) => ({ label: a.title, keywords: `${a.summary} runbook internal ops`, path: `/admin/runbooks/${a.slug}`, parent: 'Runbooks', flag: null }));
    return [...FEATURES_INDEX, ...runbooks].filter((f) => (!f.flag || optionEnabled(f.flag)) && canOpenPath(user, f.path));
  }, [optionEnabled, user, articles]);

  useOutside([searchRef], () => { setSearchOpen(false); setPhoneSearch(false); setQ(''); setFilter('all'); }, searchOpen || phoneSearch);
  useOutside([notifRef], () => setNotifOpen(false), notifOpen);

  const inputRef = useRef(null);

  useEffect(() => { if (phoneSearch) inputRef.current?.focus(); }, [phoneSearch]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { setSearchOpen(false); setPhoneSearch(false); setNotifOpen(false); setQ(''); setFilter('all'); inputRef.current?.blur(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); inputRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  /* Pages and features only. */

  const nav = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return null;
    const wantsNav = filter === 'all' || filter === 'features';
    const pages = wantsNav
      ? NAV_INDEX.filter((p) => (p.label + ' ' + p.keywords).toLowerCase().includes(term))
      : [];
    const features = wantsNav
      ? FEATURES.filter((f) => (f.label + ' ' + f.keywords + ' ' + f.parent).toLowerCase().includes(term))
      : [];
    return { pages: pages.slice(0, 4), features: features.slice(0, 8), pageCount: pages.length, featureCount: features.length };
  }, [q, filter, NAV_INDEX, FEATURES]);
  /* Listings and people, over the seam. */

  const [remote, setRemote] = useState(NO_RESULTS);

  useEffect(() => {
    const term = q.trim();
    /* Re-armed on every run rather than only cleared on teardown: a ref initialised once outside the effect stays
       `false` after StrictMode's mount/unmount/mount and swallows every result for the rest of the session. */
    if (term.length < 2) { setRemote(NO_RESULTS); return undefined; }
    let live = true;
    const timer = setTimeout(async () => {
      const [listings, people] = await Promise.allSettled([
        canReadProperties ? lookupForModeration(term, { size: RESULT_CAP }) : NOTHING,
        canReadUsers ? listUsers({ q: term, page: 0, size: RESULT_CAP }) : NOTHING,
      // Two guards, not one: `live` drops a response whose search has been superseded, and the
      // debounce above means the superseded one usually never left.
      ]);
      if (!live) return;
      setRemote({
        term,
        listings: listings.status === 'fulfilled' ? (listings.value.items || []) : [],
        listingsTotal: listings.status === 'fulfilled' ? (listings.value.total || 0) : 0,
        users: people.status === 'fulfilled' ? (people.value.items || []) : [],
        /* Named, never silently empty. */
        usersTotal: people.status === 'fulfilled' ? (people.value.total || 0) : 0,
        failed: [
          ...(listings.status === 'rejected' ? ['listings'] : []),
          ...(people.status === 'rejected' ? ['people'] : []),
        ],
      });
    }, DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [q, canReadProperties, canReadUsers]);

  const results = useMemo(() => {
    if (!nav) return null;
    // Only this search's rows count. Between keystrokes `remote` still holds the previous term's,
    // and rendering those under the new one is how a palette shows a listing that does not match.
    const fresh = remote.term === q.trim();
    const wants = (key) => fresh && (filter === 'all' || filter === key);
    const listings = wants('listings') ? remote.listings : [];
    const users = wants('users') ? remote.users : [];
    const counts = {
      features: nav.pageCount + nav.featureCount,
      // The whole match, from the server, not `items.length` — the chip is a count of what exists,
      // and the list below it is capped at six.
      listings: wants('listings') ? remote.listingsTotal : 0,
      users: wants('users') ? remote.usersTotal : 0,
    };
    return {
      pages: nav.pages,
      features: nav.features,
      listings,
      users,
      counts,
      total: counts.features + counts.listings + counts.users,
      failed: fresh ? remote.failed : [],
      // Distinguishes "nothing matched" from "the answer is still coming", which otherwise look
      // identical and one of which is a lie.
      awaiting: !fresh,
    };
  }, [nav, remote, q, filter]);

  const [notif, setNotif] = useState({ pending: [], pendingTotal: 0, open: [], openTotal: 0, replied: [], repliedTotal: 0, blind: [], total: 0 });

  // Read on mount, on open, and on a slow timer while the tab is visible; a route change does not refetch.
  const readBell = useCallback(() => {
    const settle = (bell) => setNotif(toNotif(bell, canReadProperties, canReadTickets));
    adminBell().then(settle, () => settle(null));
  }, [canReadProperties, canReadTickets]);
  const canReadBell = canReadProperties || canReadTickets;
  useEffect(() => {
    if (!canReadBell) return undefined;
    readBell();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') readBell(); }, BELL_REFRESH_MS);
    return () => clearInterval(timer);
  }, [canReadBell, readBell]);
  useEffect(() => { if (notifOpen && canReadBell) readBell(); }, [notifOpen, canReadBell, readBell]);

  const [mine, setMine] = useState([]);
  useEffect(() => {
    if (!notifOpen) return undefined;
    let live = true;
    listNotifications({ page: 0, size: 20 })
      .then((page) => { if (live) setMine(page.items.filter((n) => !n.read).slice(0, 5)); })
      .catch(() => { if (live) setMine([]); });
    return () => { live = false; };
  }, [notifOpen, unread]);

  // Queues are standing work, not news: only unread notifications and owner replies light the dot.
  const unseen = unread + notif.repliedTotal;
  const go = (path) => { setSearchOpen(false); setPhoneSearch(false); setNotifOpen(false); setQ(''); navigate(portalPath(user, path)); };
  const openMine = (n) => {
    markRead(n.id).catch(() => {}).finally(refreshUnread);
    go(safeNotificationLink(n.link));
  };
  const readAll = () => { markAllRead().catch(() => {}).finally(refreshUnread); };
  const roleIcon = (role) => (role === 'staff' ? Wrench : role === 'owner' ? ShieldCheck : User);

  return (
      /* Global search */
    <div className="flex items-center gap-3 flex-1 ml-2">
      <div className="relative flex-1 max-w-md" ref={searchRef}>
        <div className={(phoneSearch ? 'flex' : 'hidden') + ' items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2 sm:flex hover:border-white/20 focus-within:border-teal-500/40 focus-within:bg-white/[0.08] transition-all'}>
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
          <button onClick={() => setPhoneSearch(true)} className={(phoneSearch ? 'hidden' : 'grid') + ' h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-gray-300 hover:text-white sm:hidden'} aria-label="Search">
          <Search className="h-4 w-4" />
        </button>

        {searchOpen && results && (
          <div data-testid="admin-palette" className="absolute left-0 z-[60] mt-2 w-[480px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-white/10 bg-ink-2 shadow-2xl flex flex-col max-sm:fixed max-sm:inset-x-3 max-sm:top-14 max-sm:mt-0 max-sm:w-auto max-sm:max-w-none" style={{ maxHeight: '75vh' }}>
            <div className="flex items-center gap-1 px-3 py-2.5 border-b border-white/10 shrink-0 flex-wrap">
              {FILTER_CHIPS.map((c) => {
                const count = c.key === 'all' ? results.total : (results.counts[c.key] || 0);
                return (
                  <button key={c.key} onClick={() => setFilter(c.key)} className={'whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ' + (filter === c.key ? 'bg-teal-500/20 text-teal-300' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200')}>
                    {c.label}{count > 0 ? ' (' + count + ')' : ''}
                  </button>
                );
              })}
              <span className="ml-auto text-[11px] text-gray-500 tabular-nums shrink-0">{results.total} found</span>
            </div>

            <div className="overflow-y-auto p-2 flex-1">
              {/* "No matches" is an answer; it must not show before both listing and people searches settle. */}
              {results.total === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-500">
                  {results.awaiting ? 'Searching listings and people…' : 'No matches found'}
                </div>
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
                      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Listings ({results.counts.listings})</div>
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
                      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">People ({results.counts.users})</div>
                      {results.users.map((u) => { const RI = roleIcon(u.role); return (
                        <button key={u.id} onClick={() => go(u.role === 'owner' || u.role === 'buyer' ? '/admin/users' : '/admin/team')} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300"><RI className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{u.name}</span><span className="block truncate text-xs text-gray-400">{u.role} &middot; {u.mobile}</span></span>
                          {u.verified && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-teal-400" />}
                        </button>
                      ); })}
                    </>
                  )}
                </>
              )}
            {/* Outside the scroll area on purpose: an operator who typed a colleague's name and got a short list has
               to be able to read that a desk refused without scrolling to it. */}
            </div>
            {results.failed.length > 0 && (
              <div data-testid="palette-partial" className="shrink-0 border-t border-white/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200/80">
                <span className="font-semibold text-amber-200">Some of this search did not answer.</span>{' '}
                The {prose(results.failed)} {results.failed.length > 1 ? 'searches' : 'search'} failed
                or was refused for your role, so anything matching there is missing from this list
                rather than absent from the system. Open Properties or Users directly.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="relative" ref={notifRef}>
        <button onClick={() => setNotifOpen((o) => !o)} className="tap-extend relative grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-gray-300 hover:text-white" aria-label="Notifications" title={unseen > 0 ? `${unseen} unread` : 'Notifications'}>
          <Bell className="h-4 w-4" />
          {unseen > 0 && <span data-testid="notif-unread-dot" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-400" />}
        </button>
        {notifOpen && (
          <div data-testid="admin-notifications" className="absolute right-0 z-40 mt-2 w-80 overflow-y-auto rounded-2xl border border-white/10 bg-ink-2 p-2 shadow-2xl" style={{ maxHeight: '70vh' }}>
            {notif.total === 0 && notif.blind.length === 0 && unread === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-gray-500">All caught up.</div>
            ) : (
              <>
                {unread > 0 && (
                  <>
                    <div className="flex items-center justify-between px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      <span>For you ({unread})</span>
                      <button onClick={readAll} className="normal-case tracking-normal text-teal-300 hover:text-teal-200">Mark all read</button>
                    </div>
                    {mine.map((n) => (
                      <button key={n.id} onClick={() => openMine(n)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500/15 text-rose-300"><Bell className="h-4 w-4" /></span>
                        <span className="min-w-0"><span className="block truncate text-sm text-white">{n.title}</span><span className="block truncate text-xs text-gray-400">{n.desc}</span></span>
                      </button>
                    ))}
                  </>
                )}
                {notif.replied.length > 0 && (
                  <>
                    <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Owner replied ({notif.repliedTotal})</div>
                    {notif.replied.map((r) => (
                      <button key={r.propertyId} onClick={() => go(`/admin/properties?review=${encodeURIComponent(r.propertyId)}`)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500/15 text-violet-300"><MessageSquare className="h-4 w-4" /></span>
                        <span className="min-w-0"><span className="block truncate text-sm text-white">{r.propertyTitle || 'Listing'}</span><span className="block truncate text-xs text-gray-400">{r.lastMessage}</span></span>
                      </button>
                    ))}
                  </>
                )}
                {notif.pending.length > 0 && (
                  <>
                    <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Pending verification ({notif.pendingTotal})</div>
                    {notif.pending.map((l) => (
                      <button key={l.id} onClick={() => go('/admin/properties')} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-500/15 text-teal-300"><Building2 className="h-4 w-4" /></span>
                        <span className="min-w-0"><span className="block truncate text-sm text-white">{l.title}</span><span className="block truncate text-xs text-gray-400">{l.locality} &middot; {l.owner}</span></span>
                      </button>
                    ))}
                  </>
                )}
                {notif.open.length > 0 && (
                  <>
                    <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Open service requests ({notif.openTotal})</div>
                    {notif.open.map((t) => (
                      <button key={t.id} onClick={() => go(ticketPath(t, true))} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500/15 text-amber-300"><Wrench className="h-4 w-4" /></span>
                        <span className="min-w-0"><span className="block truncate text-sm text-white">{t.service}</span><span className="block truncate text-xs text-gray-400">{t.customer} &middot; {t.mobile}</span></span>
                      </button>
                    ))}
                  </>
                )}
                {notif.blind.length > 0 && (
                  <div data-testid="notif-blind" className={'px-3 py-3 text-[11px] leading-relaxed text-amber-200/80' + (notif.total > 0 ? ' mt-1 border-t border-white/10' : '')}>
                    <p className="text-xs font-semibold text-amber-200">
                      {notif.blind.length === 3 ? 'This bell is not counting anything here.' : 'Part of this bell is dark here.'}
                    </p>
                    <p className="mt-1">
                      {prose(notif.blind)} could not be counted &mdash; the desk that holds them is
                      not answering for this build or not open to your role &mdash; so the count is
                      switched off rather than made up. Open Properties and the service desks; those queues
                      are the record.
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
