import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';
import { fmtINR, timeAgo, avatarFor } from '../../../lib/format.js';
import { Card, Stat, SectionHead } from './components.jsx';
import ActionCenter from './ActionCenter.jsx';
import AadhaarVerifyModal from '../../../components/auth/AadhaarVerifyModal.jsx';
import { isAadhaarVerified } from '../../../lib/store.js';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';

export default function OverviewPanel({ isOwner, listings, enquiries, visits, go, apps, pendingApps, setStatus, toast, recent, recommended = [], stats = [], rental = null, alertMatches = [], profile = null, actionItems = [], recentSearches = [] }) {
  const { t } = useTranslation();
  const { flagEnabled } = useAppFlags();
  // Opt-in Verified badge nudge (badge-not-gate, ADR-019). Shown on the dashboard
  // landing surface as a trust prompt — never a wall. Auto-hides once earned; the
  // modal itself persists the badge (setAadhaarVerified) and government-grade
  // DigiLocker consent happens in production.
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [verified, setVerified] = useState(() => isAadhaarVerified());
  // Online rent payment isn't live yet — surface it as "Coming soon". The links
  // point to /pay-rent, which now renders an honest coming-soon page.
  const payEnabled = flagEnabled('onlineRentPayment');
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
          onVerified={() => { setVerified(true); toast(t('verify.badgeEarnedToast'), 'success'); }}
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
              <Icon name="search" className="h-3.5 w-3.5" /> Pick up where you left off
            </p>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-xl font-bold text-white sm:text-2xl">{recentSearches[0].label}</p>
                <p className="mt-1 text-xs text-gray-400">Your most recent search{recentSearches[0].at ? ' · ' + timeAgo(recentSearches[0].at) : ''}</p>
              </div>
              <Link to={recentSearches[0].url} className="btn-teal inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-semibold">
                Resume search <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
            </div>
            {recentSearches.length > 1 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
                <span className="text-xs text-gray-500">Also recent:</span>
                {recentSearches.slice(1, 4).map((s) => (
                  <Link key={s.label} to={s.url} className="max-w-[200px] truncate whitespace-nowrap rounded-full bg-white/[0.06] px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50">
                    {s.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats.map((s) => <Stat key={s.label} {...s} />)}
      </div>

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
          <Card className="p-5 sm:p-6">
            <SectionHead title="Recent Enquiries" action={<button onClick={() => go('enquiries')} className="text-teal-400 text-sm font-medium hover:text-teal-300">View all</button>} />
            <div className="space-y-3">
              {enquiries.slice(0, 3).map((e) => (
                <div key={e.id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/[0.04] transition-colors">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-xs">{avatarFor(e.customer)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{e.customer}</p>
                    <p className="text-gray-500 text-xs truncate">{e.kind === 'visit' ? 'Requested a site visit' : 'Enquired'} — {e.listing}</p>
                  </div>
                  <span className="text-gray-500 text-xs whitespace-nowrap">{timeAgo(e.at)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionHead
              icon="users-round"
              title="Flat-share Group Applications"
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
                      <button onClick={() => { setStatus(a.id, 'accepted'); toast('Group application accepted', 'success'); }} className="text-[11px] px-3 py-1.5 rounded-lg bg-teal-500/90 hover:bg-teal-500 text-white font-semibold">Accept</button>
                      <button onClick={() => { setStatus(a.id, 'declined'); toast('Group application declined'); }} className="text-[11px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-semibold">Decline</button>
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
            <SectionHead title={feedTitle} action={<button onClick={() => go('recent')} className="text-teal-400 text-sm font-medium hover:text-teal-300">View all</button>} />
            {feed.length ? (
              /* One DOM list, two layouts: a swipeable rail on phones (3 homes = one
                 screen, not three stacked blocks) that becomes a 3-up grid from sm+.
                 Single node set keeps deep-links/tests unambiguous (no responsive dupes). */
              <HScroll wrapClassName="-mx-1" className="flex gap-3 px-1 pb-1 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible">
                {feed.slice(0, 3).map((p) => (
                  <Link key={p.id} to={`/property/${p.id}`} className="w-40 flex-shrink-0 rounded-xl overflow-hidden bg-white/[0.03] transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 sm:w-auto">
                    <img src={p.image} alt={p.title} className="h-24 w-full object-cover sm:h-28" />
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

      {/* My Rentals — a real, time-sensitive tenancy with a payment action, so it
          stays VISIBLE (out of the collapsed services group). Seeker-only, and only
          when the user is actually tracking a finalised rental. */}
      {!isOwner && rental && (
        <Card className="p-5 sm:p-6">
          <SectionHead icon="house" title="My Rentals" sub="Homes you've finalised on PuneNest. Pay rent and get an instant HRA receipt." action={payEnabled
            ? <Link to="/pay-rent" className="text-teal-400 text-sm font-medium hover:text-teal-300 whitespace-nowrap">Rent &amp; Deposit →</Link>
            : <Link to="/pay-rent" className="text-gray-400 hover:text-gray-200 text-xs font-medium whitespace-nowrap">Coming soon</Link>} />
          <div className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.03]">
            <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center"><Icon name="house" className="w-5 h-5 text-teal-400" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{rental.title}</p>
              <p className="text-gray-500 text-xs">Rent {fmtINR(rental.monthlyRent)}/mo · due {rental.dueDay || 5}th</p>
            </div>
            {payEnabled
              ? <Link to="/pay-rent" className="text-[11px] px-3 py-1.5 rounded-lg bg-teal-500/90 hover:bg-teal-500 text-white font-semibold">Pay rent</Link>
              : <Link to="/pay-rent" className="text-[11px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 font-semibold">Soon</Link>}
          </div>
        </Card>
      )}

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
