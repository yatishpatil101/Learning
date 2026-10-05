import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import PropertyImage from '../../../components/ui/PropertyImage.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';
import { fmtAgo, fmtINR } from '../../../lib/format.js';
import { Card, SectionHead } from './components.jsx';
import ActionCenter from './ActionCenter.jsx';
import VerifyIdentityRedirect from '../../../components/auth/VerifyIdentityRedirect.jsx';
import { useVerification } from '../../../context/VerificationContext.jsx';

/* Three, because the tiles are 2-up below `sm`: four cost two full rows at the densest part of the Account tab, while
   three plus "See all" fills the same two rows with the fourth cell doing useful work. */
const statTile = ({ trend: _trend, ...stat }) => stat;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

      {/* Action Center is pinned so waiting requests do not go stale in a sub-tab. */}
  // /pay-rent is static for now, so links must not promise a real in-app rent flow.
  // Verified badge is a trust prompt, never a wall; earning the badge hides it.
function OverviewMetric({ value, label, onClick, ariaLabel }) {
  const body = (
    <>
      <span className="block text-2xl font-bold leading-none text-white">{value}</span>
      <p className="mt-2 truncate text-xs font-medium text-gray-300">{label}</p>
    </>
  );
  const className = 'glass-card min-h-[72px] rounded-2xl p-3.5 text-left transition-all hover:border-teal-400/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 sm:p-4';
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={ariaLabel || label} className={className}>{body}</button>
  ) : (
    <Card className="min-h-[72px] p-3.5 sm:p-4">{body}</Card>
  );
}

      {/* Verified badge nudge — an opt-in trust prompt (badge-not-gate). */}
function ResumeSearchCard({ searches, t }) {
  if (!searches.length) return null;
  const [first, ...rest] = searches;
  return (
    <Card className="relative overflow-hidden p-5 sm:p-6" data-testid="resume-search">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-teal-500/10 via-transparent to-transparent" />
      <div className="relative">
        <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-400/90">
          <Icon name="search" className="h-3.5 w-3.5" /> {t('dashboard.resumeEyebrow', 'Pick up where you left off')}
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-xl font-bold text-white sm:text-2xl">{first.label}</p>
            <p className="mt-1 text-xs text-gray-400">{t('dashboard.resumeSubtitle', 'Your most recent search')}{first.at ? ' · ' + fmtAgo(first.at) : ''}</p>
          </div>
                {/* `fmtAgo`, not `timeAgo`: the rail's `at` is epoch ms, and a search run twenty minutes ago
                   should not read "Today" on a card whose point is that you were just here. */}
                {/* and */}
      {/* Continue your search — a returning seeker's #1 job is to resume the hunt. */}
          <Link to={first.url} className="btn-teal inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-semibold">
            {t('dashboard.resumeCta', 'Resume search')} <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
        </div>
        {rest.length ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
            <span className="text-xs text-gray-500">{t('dashboard.resumeAlso', 'Also recent:')}</span>
            {rest.slice(0, 3).map((search) => (
              <Link key={search.url} to={search.url} className="max-w-[200px] truncate whitespace-nowrap rounded-full bg-white/[0.06] px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50">
                {search.label}
              </Link>
            ))}
          </div>
        ) : null}
        {/* On phones only the first three metrics render; the rest move into a sheet. */}
      </div>
    </Card>
  );
}

function AlertRow({ match }) {
  const count = Number(match.count ?? match.newCount ?? 0);
  const badge = `${plural(count, 'home', 'homes')} ${count === 1 ? 'matches' : 'match'}`;
  return (
    <Link to={match.href} className="group flex min-h-[56px] items-center gap-3.5 rounded-xl bg-white/[0.03] p-3.5 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-400/15">
        <Icon name="home" className="h-5 w-5 text-teal-400" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">{match.label}</span>
        <span className="block text-xs text-gray-500">{badge} right now</span>
      </span>
      <span className="whitespace-nowrap rounded-full bg-teal-500/15 px-2 py-0.5 text-[11px] font-semibold text-teal-300">{badge}</span>
      <Icon name="chevron-right" className="h-4 w-4 text-gray-600 transition-colors group-hover:text-teal-400" />
    </Link>
  );
}

function AlertNudge({ matches, go }) {
  return (
    <Card className="p-5 sm:p-6" data-testid="alert-matches">
      <SectionHead
        icon="bell-ring"
        iconCls="text-teal-400"
        title="New matches for your alerts"
        sub="Fresh homes that fit your saved search."
        action={<button type="button" onClick={() => go('alerts')} className="text-sm font-medium text-teal-400 hover:text-teal-300">Manage</button>}
      />
      <div className="space-y-2">
        {matches.map((match) => <AlertRow key={match.id || match.label} match={match} />)}
      </div>
    </Card>
  );
}

function VerifyNudge({ onStart, t }) {
  return (
    <Card className="relative overflow-hidden p-5 sm:p-6" data-testid="verify-badge-cta">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/15">
            <Icon name="shield-check" className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white sm:text-base">
              {t('verify.overviewTitle')}
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('verify.overviewOptional')}</span>
            </p>
            <p className="mt-1 text-xs text-gray-400 sm:text-sm">{t('verify.overviewBody')}</p>
          </div>
        </div>
        <button type="button" onClick={onStart} data-testid="verify-badge-btn" className="btn-teal inline-flex min-h-[44px] flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-semibold">
          <Icon name="shield-check" className="h-4 w-4" /> {t('verify.overviewCta')}
        </button>
      </div>
    </Card>
  );
}

              /* Tapping a tile navigates; the sheet must close with it or the user lands on the target page with an
                 overlay still up. */
function ProfileNudge({ profile, go }) {
  return (
    <Card className="p-5 sm:p-6" data-testid="profile-meter">
      <SectionHead icon="user-cog" iconCls="text-teal-400" title="Complete your profile" sub="Add the missing details owners expect to see." />
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={profile.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
          <div className="h-full rounded-full bg-gradient-to-r from-teal-400 to-teal-600 transition-all" style={{ width: profile.percent + '%' }} />
        </div>
        <span className="whitespace-nowrap text-sm font-bold text-white">{profile.percent}%</span>
      </div>
      {profile.next ? (
        <button type="button" onClick={() => go('profile')} className="btn-teal mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold">
          {profile.next.label} <Icon name="arrow-right" className="h-4 w-4" />
        </button>
      ) : null}
    </Card>
  );
}

      {/* Retention loop — real, personalised nudges that give the user a reason to come back: fresh matches for their
         saved searches and a profile-completion meter. */}
function SeekerFeed({ recent, recommended, go }) {
  const hasRecent = recent.length > 0;
  const feed = hasRecent ? recent : recommended;
  const title = hasRecent ? 'Recently viewed' : 'Recommended';
  const action = hasRecent
    ? <button type="button" onClick={() => go('recent')} className="inline-flex min-h-[44px] items-center justify-end text-sm font-medium text-teal-400 hover:text-teal-300">View all</button>
    : <Link to="/listings" className="inline-flex min-h-[44px] items-center justify-end text-sm font-medium text-teal-400 hover:text-teal-300">Browse listings</Link>;

  return (
    <Card className="p-5 sm:p-6">
      <SectionHead title={title} action={action} />
      {feed.length ? (
        <HScroll wrapClassName="-mx-1" className="flex gap-3 px-1 pb-1 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible">
          {feed.slice(0, 3).map((property) => (
            <Link key={property.id} to={`/property/${property.id}`} className="w-40 flex-shrink-0 overflow-hidden rounded-xl bg-white/[0.03] transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 sm:w-auto">
              <PropertyImage src={property.image} alt={property.title} className="h-24 w-full object-cover sm:h-28" />
              <div className="p-3">
                <p className="truncate text-sm font-semibold text-white">{property.title}</p>
                <p className="mt-0.5 text-sm font-bold text-teal-400">{fmtINR(property.price)}{property.deal === 'rent' ? '/mo' : ''}</p>
              </div>
            </Link>
          ))}
        </HScroll>
      ) : (
        <div className="py-6 text-center">
          <p className="text-sm text-gray-400">No homes to show yet.</p>
          <Link to="/listings" className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-teal-400 hover:text-teal-300">
            <Icon name="search" className="h-4 w-4" /> Browse listings
          </Link>
        </div>
      )}
    </Card>
  );
}

              /* One DOM list, two layouts: a swipeable rail on phones (3 homes = one screen, not three stacked
                 blocks) that becomes a 3-up grid from sm+. */
export default function OverviewPanel({ isOwner, go, recent, recommended = [], stats = [], alertMatches = [], profile = null, actionItems = [], recentSearches = [] }) {
  const { t } = useTranslation();
  const [badgeOpen, setBadgeOpen] = useState(false);
  const { verified } = useVerification();
  const statTiles = stats.map(statTile);
  const showProfile = profile && profile.percent < 100;
  const nudge = alertMatches.length
    ? <AlertNudge matches={alertMatches} go={go} />
    : !verified
      ? <VerifyNudge onStart={() => setBadgeOpen(true)} t={t} />
      : showProfile
        ? <ProfileNudge profile={profile} go={go} />
        : null;
  const seekerVisitOnly = !isOwner && actionItems.length > 0 && actionItems.every((item) => item.kind === 'visit' || String(item.id || '').startsWith('visit:'));

      {/* Primary quick actions — the user's main next steps. */}
  return (
    <div className="space-y-5 sm:space-y-6">
      <ActionCenter items={actionItems} limit={3} onSeeAll={isOwner ? () => go('leads') : seekerVisitOnly ? () => go('visits') : undefined} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 lg:grid-cols-4" data-testid="dashboard-stats-grid">
        {statTiles.map((stat) => <OverviewMetric key={stat.label} {...stat} />)}
      </div>

      {/* ===== Services & rewards — the demoted growth/utility tail. */}
      {nudge}
      {badgeOpen ? <VerifyIdentityRedirect source="overview_dashboard" onClose={() => setBadgeOpen(false)} /> : null}

        {/* Refer & Earn — aggressive, always-on growth surface. */}
      <ResumeSearchCard searches={recentSearches} t={t} />

        {/* Lower-frequency services + help, collapsed by default to shorten the mobile scroll. */}
      {!isOwner ? <SeekerFeed recent={recent} recommended={recommended} go={go} /> : null}
    </div>
  );
}
