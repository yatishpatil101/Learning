import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useSaved } from '../../context/SavedContext.jsx';
import { useFollows } from '../../context/FollowContext.jsx';
import { useSavedSearches } from '../../context/SavedSearchContext.jsx';
import { firstName } from '../../lib/auth.js';
import { useConversationUnread } from '../../context/ConversationContext.jsx';
import { useVerification } from '../../context/VerificationContext.jsx';
import { listRecentSearches } from '../../services/recentSearchService.js';
import { myTenancies } from '../../services/rentService.js';
import VisitsTab from '../../components/dashboard/VisitsTab.jsx';
import DocumentsTab from '../../components/dashboard/DocumentsTab.jsx';
import FinancesTab from '../../components/dashboard/FinancesTab.jsx';
import ProfileTab from '../../components/dashboard/ProfileTab.jsx';
import { TABS, TAB_ALIAS, REVIEW_STATUS_MAP, buildDashboardGroups } from './dashboard/constants.js';
import { profileCompletion } from './dashboard/retention.js';
import { listManaged } from '../../services/managedService.js';
import { listMyServiceRequestInvites } from '../../services/serviceRequestService.js';
import LoadError from '../../components/LoadError.jsx';
import OverviewPanel from './dashboard/OverviewPanel.jsx';
import MyPropertiesPanel from './dashboard/MyPropertiesPanel.jsx';
import MyRentalPanel from './dashboard/MyRentalPanel.jsx';
import EnquiriesPanel from './dashboard/EnquiriesPanel.jsx';
import BillingPanel from './dashboard/BillingPanel.jsx';
import ActivityPanel from './dashboard/ActivityPanel.jsx';
import MobileNav from './dashboard/MobileNav.jsx';
import DashboardSidebar from './dashboard/DashboardSidebar.jsx';
import DashboardReviewModal from './dashboard/DashboardReviewModal.jsx';
import { useDashboardData } from './dashboard/useDashboardData.js';
import { attentionFromItems, buildActionItems, buildDocGroups, buildOwnerStats, buildSeekerStats, countUpcomingVisits } from './dashboard/dashboardData.js';
import { DashboardOverviewSkeleton } from './dashboard/DashboardSkeleton.jsx';

export default function Dashboard() {
  const { t: tr } = useTranslation();
  const { user, update, logout } = useAuth();
  const saved = useSaved();
  const follows = useFollows();
  const savedSearches = useSavedSearches();
  const { flagEnabled } = useAppFlags();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const { unread: chatUnread } = useConversationUnread();
  /* Loaded into state because this is a request: the first paint has an empty array and the tabs appear when the
     answer lands. */
  // Management tabs unlock on actual inventory, not on role, so a brand-new owner is not handed
  // empty "My Listings / Enquiries / Finances" dead-ends.
  const { verified } = useVerification();
  const [managedProps, setManagedProps] = useState([]);
  useEffect(() => {
    let live = true;
    listManaged()
      .then((rows) => { if (live) setManagedProps(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (live) setManagedProps([]); });
    return () => { live = false; };
  }, [user?.mobile]);
  const hasManaged = managedProps.length > 0;
  const ownsInventory = hasManaged;
  /* Loaded above the tab logic because `listings` decides whether this user is an owner, and that gates which tabs
     exist at all. */

  const {
    listings, visits, recent, recommended, alertMatches,
    contactReqs, photoReqs, flatmateReqs, docReqs,
    reviewProp, setReviewProp, reviewInput, setReviewInput, reviewsByProp, reviewThread,
    apps, decideApp,
    decideContact, decideDocReqs, decideFlatmateReq, decidePhotoReq, mutateVisit, openReview, sendReview,
    dataStatus, dataError, retryData,
    docReqsStatus, docReqsError, retryDocReqs,
    contactReqsStatus, contactReqsError, retryContactReqs,
    photoReqsStatus, photoReqsError, retryPhotoReqs,
    flatmateReqsStatus, flatmateReqsError, retryFlatmateReqs,
    appsStatus, appsError, retryApps,
    isBusy, refreshData,
  } = useDashboardData({ user, toast });
  /* "My Rental" (the home you rent) shows for buyers/tenants and anyone with a finalised tenancy — but not for a pure
     owner who rents nothing. */
  const isOwner = (listings || []).length > 0 || ownsInventory;
  const [hasTenancy, setHasTenancy] = useState(false);
  useEffect(() => {
    let live = true;
    myTenancies()
      .then((rows) => { if (live) setHasTenancy((rows || []).length > 0); })
      .catch(() => { if (live) setHasTenancy(false); });
    return () => { live = false; };
  /* A pending co-fill invite (owner asked this user to add their tenant details) also belongs in "My Rental", so an
     invited tenant always has a place to act. */
  }, [user?.mobile]);
  const [hasRentalInvite, setHasRentalInvite] = useState(false);
  useEffect(() => {
    let live = true;
    listMyServiceRequestInvites()
      .then((rows) => {
        if (live) setHasRentalInvite((rows || []).some((row) => row?.status === 'invited'));
      })
      .catch(() => { if (live) setHasRentalInvite(false); });
    return () => { live = false; };
  }, [user?.mobile]);
  const showRental = hasTenancy || !isOwner || hasRentalInvite;
  const hasRentalGroup = hasTenancy || hasRentalInvite;

  const visibleTabs = useMemo(
    () => TABS.filter((t) => (!t.owner || isOwner) && (!t.tenant || showRental) && (!t.flag || flagEnabled(t.flag))),
    [isOwner, showRental, flagEnabled],
  );
  const dashboardGroups = useMemo(
    () => buildDashboardGroups({ visibleTabs, isOwner, showRental, hasRentalGroup }),
    [visibleTabs, isOwner, showRental, hasRentalGroup],
  );
  // Resolve the active tab from either the hash (#listings) or a ?tab= query
  // param, so deep-links from anywhere in the app land on the right tab.

  const tabFromLocation = () => {
    const h = location.hash.replace('#', '');
    const q = new URLSearchParams(location.search).get('tab') || '';
    return h || q;
  };
  // Map a raw candidate (real tab id OR legacy alias) to { tab, sub }. Aliases keep
  // every historical deep-link working after the 13→9 tab consolidation.
  const resolveTarget = (candidate) => {
    if (candidate && TAB_ALIAS[candidate]) return TAB_ALIAS[candidate];
    return { tab: candidate || 'overview' };
  };
  const urlTarget = resolveTarget(tabFromLocation());
  const urlDef = visibleTabs.find((t) => t.tab === urlTarget.tab);
  const { tab, sub } = urlDef && !urlDef.link ? urlTarget : { tab: 'overview', sub: undefined };

  const REVIEW_STATUS = REVIEW_STATUS_MAP;

  const go = (next, { replace = false } = {}) => {
    const r = resolveTarget(next);
    const def = visibleTabs.find((t) => t.tab === r.tab);
    if (!def) return;
    // Link-out tabs (e.g. Messages) open a standalone page, not an inline panel.
    if (def.link) { navigate(def.link); return; }
    const apply = () => { navigate('#' + next, { replace }); window.scrollTo(0, 0); };
    // Use View Transition API for smooth tab cross-fade (if supported)
    if (document.startViewTransition) document.startViewTransition(apply);
    else apply();
  };
  // Keep the active tab in sync with the URL (deep links + back/forward).

  useEffect(() => {
    // A deep link to a link-out tab (#messages) redirects to its real page so we
    // never render a divergent inline version of it.
    if (urlDef?.link) navigate(urlDef.link, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redirect only follows the active URL tab
  }, [urlDef?.link]);

  const reviewParam = new URLSearchParams(location.search).get('review');
  useEffect(() => {
    if (!reviewParam) return;
    openReview(reviewParam);
    const rest = new URLSearchParams(location.search);
    rest.delete('review');
    navigate({ search: rest.toString() ? `?${rest}` : '', hash: location.hash }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- review deep-link is consumed once
  }, [reviewParam]);

  const docGroups = useMemo(() => buildDocGroups(docReqs, listings), [docReqs, listings]);
  const pendingDocGroups = docGroups.filter((g) => g.pendingIds.length > 0);
  const savedCount = saved.count;
  const alertCount = savedSearches.count;
  // From the context, so the tile agrees with the same user's count on another device and with the
  // follower count the society hub computes server-side.
  const followCount = follows.count;
  // Seekers only — owners have their own flow, so asking for a rail nothing will render is a wasted
  // call. Starts empty, the same shape as "no history yet", so nothing flashes before the read.
  const [recentSearches, setRecentSearches] = useState([]);
  useEffect(() => {
    let alive = true;
    setRecentSearches([]);
    listRecentSearches()
      .then((rows) => { if (alive) setRecentSearches(rows); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [user?.mobile]);
  // Real profile-completion meter (name/email/city + Aadhaar verification).
  const profile = useMemo(() => profileCompletion(user, verified), [user, verified]);
  // ---- Action Center: what is waiting on this user. Computed per render (small arrays) so the
  // inline handlers below are never stale, and sorted stale-first. ----

  const scheduledVisits = useMemo(() => visits.filter((v) => v.status === 'scheduled'), [visits]);
  const actionItems = buildActionItems({
    isOwner, contactReqs, apps, photoReqs, pendingDocGroups, listings, reviewsByProp,
    scheduledVisits, flatmateReqs, userId: user?.id, openReview, isBusy,
    decideContact, decideApp, go, decideDocReqs, decidePhotoReq, decideFlatmateReq, mutateVisit, navigate,
  });
  // Badge counts only items genuinely waiting on the owner, matching the Requests panel's
  // "Waiting on you"; an already-contactable enquiry needs no accept/decline decision.
  const attentionCounts = { ...attentionFromItems(actionItems), messages: chatUnread };

  // Total open leads, computed exactly as the Leads panel computes its own total, so the Overview
  // tile and the panel can never show two different numbers for the same inbox.
  const upcomingVisits = countUpcomingVisits(visits, user?.id);
  const ownerStats = buildOwnerStats({ listings, items: actionItems, go });
  const seekerStats = buildSeekerStats({ savedCount, alertCount, followCount, upcomingVisits, go });
  const hasAnyCoreData = [
    listings, visits, recent, recommended, alertMatches, contactReqs, photoReqs, flatmateReqs, docReqs, apps,
  ].some((rows) => (rows || []).length > 0);
  const personaPending = dataStatus === 'loading' && !hasAnyCoreData;
  /* Panel components are imported so their identity is stable across Dashboard re-renders: a state change here would
     otherwise remount the active panel and wipe its internal state. */

  const renderPanel = () => {
    if (tab === 'overview' && personaPending) return <DashboardOverviewSkeleton />;
    switch (tab) {
      case 'properties':
        return <MyPropertiesPanel key={'prop:' + (sub || '')} initialSub={sub} isOwner={isOwner} listings={listings} user={user} toast={toast} REVIEW_STATUS={REVIEW_STATUS} openReview={openReview} reviewsByProp={reviewsByProp} onChanged={refreshData} />;
      case 'rental':
        return <MyRentalPanel user={user} toast={toast} />;
      case 'activity':
        return <ActivityPanel key={'act:' + (sub || '')} initialSub={sub} recent={recent} />;
      case 'leads':
        return <EnquiriesPanel contactReqs={contactReqs} decideContact={decideContact} photoReqs={photoReqs} decidePhotoReq={decidePhotoReq} flatmateReqs={flatmateReqs} decideFlatmateReq={decideFlatmateReq} docReqs={docReqs} decideDocReqs={decideDocReqs} listings={listings} apps={apps} decideApp={decideApp} openReview={openReview} reviewsByProp={reviewsByProp} contactReqsFailed={contactReqsStatus === 'error'} contactReqsError={contactReqsError} onRetryContactReqs={retryContactReqs} photoReqsFailed={photoReqsStatus === 'error'} photoReqsError={photoReqsError} onRetryPhotoReqs={retryPhotoReqs} docReqsFailed={docReqsStatus === 'error'} docReqsError={docReqsError} onRetryDocReqs={retryDocReqs} flatmateReqsFailed={flatmateReqsStatus === 'error'} flatmateReqsError={flatmateReqsError} onRetryFlatmateReqs={retryFlatmateReqs} appsFailed={appsStatus === 'error'} appsError={appsError} onRetryApps={retryApps} isBusy={isBusy} />;
      case 'finances':
        return <FinancesTab user={user} listings={listings} toast={toast} isOwner={isOwner} showRental={showRental} />;
      case 'documents':
        return <DocumentsTab user={user} listings={listings} toast={toast} isOwner={isOwner} />;
      case 'visits':
        return <VisitsTab visits={visits} toast={toast} isOwner={isOwner} onUpdate={mutateVisit} />;
      case 'billing':
        return <BillingPanel isOwner={isOwner} />;
      case 'profile':
        return <ProfileTab user={user} update={update} toast={toast} isOwner={isOwner} />;
      default:
        return <OverviewPanel actionItems={actionItems} isOwner={isOwner} go={go} recent={recent} recommended={recommended} stats={isOwner ? ownerStats : seekerStats} alertMatches={alertMatches} profile={profile} recentSearches={recentSearches} />;
    }
  };

  return (
    <div className="pt-6 lg:pt-8 pb-20 min-h-[100dvh]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Hi, {firstName(user)} <span className="inline-block">👋</span></h1>
          <p className="text-gray-400 text-sm mt-1">Here's your Draazy activity.</p>
        </div>
        {/* Mobile section switcher — one row that opens a full sheet of all sections, so nothing (and no attention
           badge) is hidden behind a horizontal scroll. */}

        <MobileNav
          groups={dashboardGroups}
          activeTab={tab}
          onSelect={go}
          attentionCounts={attentionCounts}
          loading={personaPending}
          labelFor={(t) => tr('dashboard.tabs.' + t.tab, { defaultValue: t.label })}
        />

        <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-6">
          {/* Sidebar */}
          <DashboardSidebar
            groups={dashboardGroups}
            activeTab={tab}
            onSelect={go}
            attentionCounts={attentionCounts}
            user={user}
            onLogout={logout}
            loading={personaPending}
          />
          {/* Content */}

          <section>
            {dataStatus === 'error' && (
              <LoadError message={tr('dash.dashboardLoadError')} error={dataError} onRetry={retryData} className="glass-card rounded-2xl p-5 mb-5" />
            )}
            {renderPanel()}
          </section>
        </div>
      </div>

      <DashboardReviewModal
        reviewProp={reviewProp}
        setReviewProp={setReviewProp}
        thread={reviewThread}
        listing={(listings || []).find((l) => l.id === reviewProp || l.uuid === reviewProp)}
        reviewInput={reviewInput}
        setReviewInput={setReviewInput}
        sendReview={sendReview}
        REVIEW_STATUS={REVIEW_STATUS}
      />
    </div>
  );
}
