import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import PropertyImage from '../../../components/ui/PropertyImage.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import { fmtINR, fmtAgo } from '../../../lib/format.js';
import { Card, Stat, SectionHead } from './components.jsx';
import ActionCenter from './ActionCenter.jsx';
import AadhaarVerifyModal from '../../../components/auth/AadhaarVerifyModal.jsx';
import { useVerification } from '../../../context/VerificationContext.jsx';

/* How many stat tiles a phone shows before the rest move behind "See all".

   Three is not arbitrary: the tiles are a 2-up grid below `sm`, so four of them
   cost two full rows near the top of the Account tab — the densest, least-scanned
   part of a screen that already stacks 9+ sections. Three plus a "See all" tile
   fills exactly two rows with the fourth cell doing useful work, and it forces the
   panel to say which metrics actually lead. Desktop keeps all four: a 4-up row
   there costs one row and no scroll. */
const MOBILE_STAT_LIMIT = 3;

export default function OverviewPanel({ isOwner, go, apps, pendingApps, decideApp, toast, recent, recommended = [], stats = [], alertMatches = [], profile = null, actionItems = [], recentSearches = [] }) {
  const { t } = useTranslation();
  // Opt-in Verified badge nudge (badge-not-gate, ADR-019). Shown on the dashboard
  // landing surface as a trust prompt — never a wall. Auto-hides once earned; the
  // badge is held once in VerificationContext and the modal starts the seam write
  // (mock grants at once; production redirects to DigiLocker and waits on the webhook).
  const [badgeOpen, setBadgeOpen] = useState(false);
  const { verified } = useVerification();
  // "See all metrics" sheet — the overflow half of the mobile stat split.
  const [allStatsOpen, setAllStatsOpen] = useState(false);
  // Paying rent in-app is not built — /pay-rent is a static coming-soon page, so these links say
  // so rather than promising a flow that does not exist.
  const feed = recent.length ? recent : recommended;
  const feedTitle = recent.length ? 'Continue Exploring' : 'Recommended for you';
  const showProfile = profile && profile.percent < 100;
  const showRetention = alertMatches.length > 0 || showProfile;
  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Action Center — the single "what's waiting on you" triage, pinned at the
          very top so no request goes stale in a sub-tab. */}
      <ActionCenter items={actionItems} />

      {/* Verified badge nudge — an opt-in trust prompt (badge-not-gate). Sits high
          on the landing surface so it's easy to find, but it never blocks anything
          and disappears the moment the badge is earned. */}
      {!verified && (
        <Card className="relative overflow-hidden p-5 sm:p-6" data-testid="verify-badge-cta">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/15">
                <Icon name="shield-check" className="h-5 w-5 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-white sm:text-base">
                  {t('verify.overviewTitle')}
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('verify.overviewOptional')}</span>
                </p>
                <p className="mt-1 text-xs text-gray-400 sm:text-sm">{t('verify.overviewBody')}</p>
              </div>
            </div>
            <button onClick={() => setBadgeOpen(true)} data-testid="verify-badge-btn" className="btn-teal inline-flex flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-semibold">
              <Icon name="shield-check" className="h-4 w-4" /> {t('verify.overviewCta')}
            </button>
          </div>
        </Card>
      )}
      {badgeOpen && (
        <AadhaarVerifyModal
          source="overview_dashboard"
          subtitle={t('verify.subtitleProfile')}
          onClose={() => setBadgeOpen(false)}
          onVerified={() => { toast(t('verify.badgeEarnedToast'), 'success'); }}
        />
      )}

      {/* Continue your search — a returning seeker's #1 job is to resume the hunt.
          Built only from the user's OWN recent searches (persistent, per-user), so
          it never appears unless there's a real search to pick up. Owners have a
          different flow and never see this. */}
      {!isOwner && recentSearches.length > 0 && (
        <Card className="relative overflow-hidden p-5 sm:p-6" data-testid="resume-search">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-teal-500/10 via-transparent to-transparent" />
          <div className="relative">
            <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-400/90">
              <Icon name="search" className="h-3.5 w-3.5" /> {t('dashboard.resumeEyebrow', 'Pick up where you left off')}
            </p>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-xl font-bold text-white sm:text-2xl">{recentSearches[0].label}</p>
                {/* `fmtAgo`, not `timeAgo`: the rail's `at` is epoch milliseconds, which is what
                    fmtAgo documents, and a search run twenty minutes ago should not read "Today"
                    on a card whose whole point is that you were just here. */}
                <p className="mt-1 text-xs text-gray-400">{t('dashboard.resumeSubtitle', 'Your most recent search')}{recentSearches[0].at ? ' · ' + fmtAgo(recentSearches[0].at) : ''}</p>
              </div>
              <Link to={recentSearches[0].url} className="btn-teal inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-semibold">
                {t('dashboard.resumeCta', 'Resume search')} <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
            </div>
            {recentSearches.length > 1 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
                <span className="text-xs text-gray-500">{t('dashboard.resumeAlso', 'Also recent:')}</span>
                {/* Keyed by url, not label: the rail dedupes on the normalised url, so two rows can
                    legitimately carry the same words and a label key would collide. */}
                {recentSearches.slice(1, 4).map((s) => (
                  <Link key={s.url} to={s.url} className="max-w-[200px] truncate whitespace-nowrap rounded-full bg-white/[0.06] px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50">
                    {s.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
      {/* Headline metrics. On a phone only the first three render and the rest
          move into a sheet — the panel was a straight port of the desktop 4-up
          grid, which on a 360px screen is two dense rows of small numbers before
          the user reaches anything actionable.

          One grid, not two (tech-debt D82). This was previously a `sm:hidden`
          mobile grid beside a `hidden sm:grid` desktop one, which put **every**
          headline label in the DOM twice — so `getByText('Total Views')` was a
          Playwright strict-mode violation regardless of viewport, and any future
          assertion on any of these labels would have been too. The overflow tiles
          now sit in a `hidden sm:contents` wrapper: `display: contents` makes it
          transparent to the grid, so the desktop layout is byte-for-byte what it
          was, with one copy of each tile instead of two. */}
      {stats.length > MOBILE_STAT_LIMIT ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {stats.slice(0, MOBILE_STAT_LIMIT).map((s) => <Stat key={s.label} {...s} />)}
          <div className="hidden sm:contents">
            {stats.slice(MOBILE_STAT_LIMIT).map((s) => <Stat key={s.label} {...s} />)}
          </div>
          <button
            type="button"
            onClick={() => setAllStatsOpen(true)}
            data-testid="see-all-metrics"
            className="tap-target flex flex-col items-start justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.06] sm:hidden"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06]">
              <Icon name="layout-grid" className="h-4 w-4 text-gray-300" />
            </span>
            <span className="mt-2 text-xs font-medium text-gray-300">
              {t('dashboard.seeAllMetrics', 'See all')}
            </span>
            <span className="mt-0.5 text-[11px] text-gray-500">
              {t('dashboard.moreMetrics', '{{count}} more', { count: stats.length - MOBILE_STAT_LIMIT })}
            </span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {stats.map((s) => <Stat key={s.label} {...s} />)}
        </div>
      )}

      {/* The overflow half of the split. Modal is already a bottom sheet below
          640px, so this needs no mobile-specific presentation of its own. */}
      <Modal
        open={allStatsOpen}
        onClose={() => setAllStatsOpen(false)}
        title={t('dashboard.allMetrics', 'All metrics')}
      >
        <div className="grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <Stat
              key={s.label}
              {...s}
              /* Tapping a tile navigates; the sheet must close with it or the
                 user lands on the target page with an overlay still up. */
              onClick={s.onClick ? () => { setAllStatsOpen(false); s.onClick(); } : undefined}
            />
          ))}
        </div>
      </Modal>

      {/* Retention loop — real, personalised nudges that give the user a reason to
          come back: fresh matches for their saved searches and a profile-completion
          meter. Only renders when there is something honest to show. */}
      {showRetention && (
        <div className={'grid grid-cols-1 gap-4' + (alertMatches.length > 0 && showProfile ? ' lg:grid-cols-2' : '')}>
          {alertMatches.length > 0 && (
            <Card className="p-5 sm:p-6" data-testid="alert-matches">
              <SectionHead
                icon="bell-ring"
                iconCls="text-teal-400"
                title="New matches for your alerts"
                sub="Fresh homes that fit your saved searches."
                action={<button onClick={() => go('alerts')} className="text-teal-400 text-sm font-medium hover:text-teal-300 whitespace-nowrap">Manage</button>}
              />
              <div className="-mx-3 divide-y divide-white/[0.05]">
                {alertMatches.map((m) => (
                  <Link key={m.id} to={m.href} className="group flex items-center gap-3.5 rounded-xl py-3.5 pl-4 pr-3 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50">
                    <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center flex-shrink-0"><Icon name="home" className="w-5 h-5 text-teal-400" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{m.label}</p>
                      <p className="text-gray-500 text-xs">{m.count} {m.count === 1 ? 'home matches' : 'homes match'} right now</p>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 font-semibold whitespace-nowrap">{m.count} new</span>
                    <Icon name="chevron-right" className="w-4 h-4 text-gray-600 transition-colors group-hover:text-teal-400" />
                  </Link>
                ))}
              </div>
            </Card>
          )}
          {showProfile && (
            <Card className="p-5 sm:p-6" data-testid="profile-meter">
              <SectionHead icon="shield-check" iconCls="text-teal-400" title="Complete your profile" sub="A complete, verified profile gets faster responses from owners." />
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={profile.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
                  <div className="h-full rounded-full bg-gradient-to-r from-teal-400 to-teal-600 transition-all" style={{ width: profile.percent + '%' }} />
                </div>
                <span className="text-sm font-bold text-white whitespace-nowrap">{profile.percent}%</span>
              </div>
              <div className="space-y-2">
                {profile.steps.map((s) => (
                  <div key={s.key} className="flex items-center gap-2.5 text-sm">
                    <Icon name={s.done ? 'check-circle-2' : 'circle'} className={'w-4 h-4 flex-shrink-0 ' + (s.done ? 'text-emerald-400' : 'text-gray-600')} />
                    <span className={s.done ? 'text-gray-500 line-through' : 'text-gray-200'}>{s.label}</span>
                  </div>
                ))}
              </div>
              {profile.next && (
                <button onClick={() => go('profile')} className="btn-teal mt-4 px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5">
                  {profile.next.label} <Icon name="arrow-right" className="w-4 h-4" />
                </button>
              )}
            </Card>
          )}
        </div>
      )}

      {isOwner ? (
        <>
          {/* A "Recent Enquiries" card stood here. Its three rows came from fixtures nothing in the
              app ever wrote, so it showed the same three invented names to every owner on the site,
              on the first screen of their dashboard. Removed with the fixtures (D13) rather than
              repointed: the Action Center above already lists the real requests waiting on this
              owner, and the Leads tab lists the rest. */}
          <Card className="p-5 sm:p-6">
            <SectionHead
              icon="users-round"
              title="Flatmate Group Applications"
              sub="Groups of tenants who want to rent one of your whole flats together and split the rent."
              action={<span className="text-[11px] px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 font-semibold whitespace-nowrap">{pendingApps} pending</span>}
            />
            <div className="-mx-3 divide-y divide-white/[0.05]">
              {apps.length ? apps.map((a) => (
                <div key={a.id} className="flex items-center gap-3.5 rounded-xl py-3.5 pl-4 pr-3 transition-colors hover:bg-white/[0.03]">
                  <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center text-teal-400 flex-shrink-0">
                    <Icon name="users-round" className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{a.groupTitle}</p>
                    <p className="text-gray-500 text-xs truncate">{a.listingTitle} · {a.members}/{a.seatsTotal} members · {fmtINR(a.perHead)}/mo each</p>
                  </div>
                  {a.status === 'accepted' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold whitespace-nowrap">Accepted</span>
                  ) : a.status === 'declined' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 font-semibold whitespace-nowrap">Declined</span>
                  ) : (
                    <div className="flex gap-2 flex-shrink-0">
                      {/* Accept and Decline are irreversible from this row and sit
                          8px apart, which is the worst combination to get wrong.
                          min-h-[44px] on touch only; the 11px label and the padding
                          stay put, so the row keeps its density from sm up. */}
                      <button onClick={() => decideApp(a.id, 'accepted')} className="text-[11px] px-3 py-1.5 min-h-[44px] sm:min-h-0 rounded-lg bg-teal-500/90 hover:bg-teal-500 text-white font-semibold">Accept</button>
                      <button onClick={() => decideApp(a.id, 'declined')} className="text-[11px] px-3 py-1.5 min-h-[44px] sm:min-h-0 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-semibold">Decline</button>
                    </div>
                  )}
                </div>
              )) : <p className="text-gray-500 text-sm text-center py-4">No group applications yet.</p>}
            </div>
          </Card>
        </>
      ) : (
        <>
          <Card className="p-5 sm:p-6">
            <SectionHead title={feedTitle} action={<button onClick={() => go('recent')} className="tap-target inline-flex items-center justify-end text-teal-400 text-sm font-medium hover:text-teal-300">View all</button>} />
            {feed.length ? (
              /* One DOM list, two layouts: a swipeable rail on phones (3 homes = one
                 screen, not three stacked blocks) that becomes a 3-up grid from sm+.
                 Single node set keeps deep-links/tests unambiguous (no responsive dupes). */
              <HScroll wrapClassName="-mx-1" className="flex gap-3 px-1 pb-1 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible">
                {feed.slice(0, 3).map((p) => (
                  <Link key={p.id} to={`/property/${p.id}`} className="w-40 flex-shrink-0 rounded-xl overflow-hidden bg-white/[0.03] transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 sm:w-auto">
                    <PropertyImage src={p.image} alt={p.title} className="h-24 w-full object-cover sm:h-28" />
                    <div className="p-3">
                      <p className="text-white text-sm font-semibold truncate">{p.title}</p>
                      <p className="text-teal-400 text-sm font-bold mt-0.5">{fmtINR(p.price)}{p.deal === 'rent' ? '/mo' : ''}</p>
                    </div>
                  </Link>
                ))}
              </HScroll>
            ) : (
              <div className="text-center py-6">
                <p className="text-gray-400 text-sm">Nothing here yet.</p>
                <Link to="/listings" className="mt-2 inline-flex items-center gap-1.5 text-teal-400 text-sm font-semibold hover:text-teal-300"><Icon name="search" className="w-4 h-4" /> Browse homes</Link>
              </div>
            )}
          </Card>
        </>
      )}

      {/* Primary quick actions — the user's main next steps. Lifted ABOVE the
          growth/marketing tail so promos never sit between the user and their
          tools. On phones: a compact 2-col grid with icon-over-label tiles (no
          cramped side-by-side truncation); a 3-up row from sm+. */}
      {(() => {
        const commonCls = 'glass-card group rounded-2xl p-4 sm:p-5 flex flex-col items-start gap-2.5 text-left w-full min-h-[92px] hover:border-teal-400/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 transition-all sm:flex-row sm:items-center sm:gap-3.5 sm:min-h-0';
        const actions = isOwner
          ? [
              { to: '/list-property', icon: 'plus-circle', fg: 'text-teal-400', bg: 'bg-teal-400/15', title: 'Post a Property', sub: 'List in minutes, free' },
              { onClick: () => go('leads'), icon: 'messages-square', fg: 'text-amber-400', bg: 'bg-amber-400/15', title: 'View Requests', sub: 'Respond to your leads' },
              { onClick: () => go('properties'), icon: 'trending-up', fg: 'text-teal-400', bg: 'bg-teal-400/15', title: 'Value my Home', sub: 'Rent-o-meter estimate' },
            ]
          : [
              { to: '/schedule-visit', icon: 'calendar-check', fg: 'text-teal-400', bg: 'bg-teal-400/15', title: 'Schedule a Visit', sub: 'Book a property tour' },
              { to: '/listings', icon: 'search', fg: 'text-teal-400', bg: 'bg-teal-400/15', title: 'Browse Homes', sub: 'Explore listings' },
              { to: '/emi-calculator', icon: 'calculator', fg: 'text-amber-400', bg: 'bg-amber-400/15', title: 'EMI Calculator', sub: 'Plan your loan' },
            ];
        const body = (a) => (
          <>
            <div className={'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ' + a.bg}><Icon name={a.icon} className={'w-5 h-5 ' + a.fg} /></div>
            <div className="min-w-0"><p className="text-white text-sm font-semibold leading-tight">{a.title}</p><p className="text-gray-500 text-xs mt-0.5 truncate">{a.sub}</p></div>
          </>
        );
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {actions.map((a) => (a.to
              ? <Link key={a.title} to={a.to} className={commonCls}>{body(a)}</Link>
              : <button key={a.title} type="button" onClick={a.onClick} className={commonCls}>{body(a)}</button>
            ))}
          </div>
        );
      })()}

      {/* A "My Rentals" card stood here, gated on `!isOwner && rental`. The guard was
          self-contradictory — `rental` came out of `managedProps`, and a non-empty `managedProps`
          is one of the things that makes `isOwner` true — so it never rendered. It also read the
          wrong shape (`rental.monthlyRent`, where the tenancy cards carry `rent`) and drew from
          properties the user rents OUT, which would have described a landlord's let-out flat as
          the home they rent. Removed rather than repaired: the tenant's own rental now lives in
          the Finances tab, sourced from `myRentals()`. */}

      {/* ===== Services & rewards — the demoted growth/utility tail. One quiet label
          groups it as a single system instead of three competing banners. Refer (the
          growth driver) stays visible; the lower-frequency service/help entries fold
          into a native <details> so they're present but out of the default mobile
          scroll path — progressive disclosure with zero JS state. ===== */}
      <div className="space-y-4 pt-1">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">Services &amp; rewards</p>

        {/* Refer & Earn — aggressive, always-on growth surface. Stays visible.
            Stacks on mobile (icon+copy, then a full-width CTA), single row from sm+. */}
        <Link
          to="/refer"
          className="group relative block overflow-hidden rounded-2xl p-5 sm:p-6 border border-amber-400/25 transition-all hover:border-amber-400/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          style={{ background: 'linear-gradient(135deg,rgba(245,158,11,.12),rgba(20,184,166,.06))' }}
          data-testid="refer-promo"
        >
          <div aria-hidden="true" className="pointer-events-none absolute -right-6 -top-8 h-32 w-32 rounded-full bg-amber-400/10 blur-2xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
            <div className="flex min-w-0 flex-1 items-start gap-3.5">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-amber-400/15">
                <Icon name="gift" className="h-5 w-5 text-amber-300" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-300/90">Refer &amp; Earn</p>
                <p className="mt-1 text-white text-base font-bold leading-snug">
                  {isOwner ? 'Invite owners — earn free rent agreements' : 'Invite friends — earn +15 owner contacts each'}
                </p>
                <p className="mt-1 text-gray-400 text-xs">Share your code over WhatsApp. You both get rewarded.</p>
              </div>
            </div>
            <div className="btn-teal w-full flex-shrink-0 justify-center gap-1.5 whitespace-nowrap px-5 text-sm font-semibold sm:w-auto">
              Refer now <Icon name="arrow-right" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </Link>

        {/* Lower-frequency services + help, collapsed by default to shorten the mobile
            scroll. Native <details>/<summary> = free keyboard a11y, no state. Nested
            rows use tint (not a repeated box border) per the card-in-card rule. */}
        <details className="group glass-card overflow-hidden rounded-2xl">
          <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 p-4 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.04]">
              <Icon name="layout-grid" className="h-5 w-5 text-gray-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-semibold">More services &amp; help</p>
              <p className="text-gray-500 text-xs">{isOwner ? 'Support and more' : 'Rent agreement, support and more'}</p>
            </div>
            <Icon name="chevron-down" className="h-4 w-4 flex-shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-white/[0.06] p-4">
            {!isOwner && (
              <Link to="/services/rent-agreement" className="flex items-center gap-4 rounded-xl bg-teal-500/10 p-4 transition-colors hover:bg-teal-500/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50">
                <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center flex-shrink-0"><Icon name="file-text" className="w-5 h-5 text-teal-400" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">Register your rent agreement</p>
                  <p className="text-gray-400 text-xs mt-0.5">e-stamp, biometric &amp; registration — doorstep service.</p>
                </div>
                <span className="text-sm font-semibold text-teal-400 whitespace-nowrap">Start →</span>
              </Link>
            )}
            <Link to="/support" className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/[0.04]">
                <Icon name="life-buoy" className="h-5 w-5 text-gray-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-semibold">Need help?</p>
                <p className="text-gray-500 text-xs">Get support with a listing, payment or visit.</p>
              </div>
              <Icon name="chevron-right" className="h-4 w-4 text-gray-600" />
            </Link>
          </div>
        </details>
      </div>
    </div>
  );
}
