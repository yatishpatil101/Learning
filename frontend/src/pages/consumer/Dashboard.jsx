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
import { getRecentSearches } from '../../lib/localPrefs.js';
import { myTenancies } from '../../services/rentService.js';
import VisitsTab from '../../components/dashboard/VisitsTab.jsx';
import DocumentsTab from '../../components/dashboard/DocumentsTab.jsx';
import FinancesTab from '../../components/dashboard/FinancesTab.jsx';
import ProfileTab from '../../components/dashboard/ProfileTab.jsx';
import { TABS, TAB_ALIAS, REVIEW_STATUS_MAP } from './dashboard/constants.js';
import { profileCompletion } from './dashboard/retention.js';
import { listManaged } from '../../services/managedService.js';
import { pendingInviteCount } from '../../lib/serviceFlow.js';
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
import { buildDocGroups, buildActionItems, buildOwnerStats, buildSeekerStats } from './dashboard/dashboardData.js';

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
  const { verified } = useVerification();
  // A user is treated as an "owner" (sees listing-management tabs) only once they
  // have ACTUAL inventory: a property listing, a flatmate room, a flatmate
  // request/group, or a private managed property (Owner Hub / Rent-o-meter).
  // Role alone does NOT unlock the management tabs — otherwise a brand-new owner
  // would see empty "My Listings / Enquiries / Finances" dead-ends. The tabs
  // appear the moment they post/register their first property.
  /* Managed properties used to be read straight out of `localStorage` in the render body, twice —
     once here to decide whether the management tabs exist at all, once further down to find the
     rental being tracked. Against the API that is a request, so it moves into state and an effect
     (D32). The first paint therefore has an empty array, exactly as it does for `listings`, which
     is loaded the same way and gates the same decision; the tabs appear when the answer arrives.
     Failures fall back to empty rather than surfacing: not knowing whether someone owns anything is
     a reason to show the tenant view, not an error to put in front of them. */
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

  /* Loaded here rather than below the tab logic, because `listings` decides whether this user is an
     owner and that decision gates which tabs exist at all.

     This used to also consult `hasListings()`, which read the **localStorage** listing store — only
     what this browser posted. Against the API an owner's listings live in the database, so a real
     owner with real inventory answered `false` and was shown the tenant dashboard, with Finances
     rendering the Rent Wallet instead of their property ledger. `listings` now comes from
     `GET /me/listings` in both modes, so the probe answered nothing the list did not already say
     and could only ever disagree with it. */
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
  } = useDashboardData({ user, toast });
  const isOwner = (listings || []).length > 0 || ownsInventory;
  /* "My Rental" (the home you rent) shows for buyers/tenants and anyone with a finalised tenancy —
     but not for a pure owner who rents nothing. The tenancy comes from the server, so an owner who
     also rents somewhere sees the tab on any device rather than only on the one that recorded it. */
  const [hasTenancy, setHasTenancy] = useState(false);
  useEffect(() => {
    let live = true;
    myTenancies()
      .then((rows) => { if (live) setHasTenancy((rows || []).length > 0); })
      .catch(() => { if (live) setHasTenancy(false); });
    return () => { live = false; };
  }, [user?.mobile]);
  // A pending co-fill invite (owner asked this user to add their tenant details)
  // also belongs in "My Rental", so an invited tenant always has a place to act.
  const hasRentalInvite = pendingInviteCount(user?.mobile) > 0;
  const showRental = hasTenancy || !isOwner || hasRentalInvite;

  const visibleTabs = useMemo(
    () => TABS.filter((t) => (!t.owner || isOwner) && (!t.tenant || showRental) && (!t.flag || flagEnabled(t.flag))),
    [isOwner, showRental, flagEnabled],
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
  const initialTarget = (() => {
    const r = resolveTarget(tabFromLocation());
    return visibleTabs.some((t) => t.tab === r.tab) ? r : { tab: 'overview' };
  })();
  const [tab, setTab] = useState(initialTarget.tab);
  const [sub, setSub] = useState(initialTarget.sub);

  const REVIEW_STATUS = REVIEW_STATUS_MAP;

  const go = (next) => {
    const r = resolveTarget(next);
    const def = visibleTabs.find((t) => t.tab === r.tab);
    if (!def) return;
    // Link-out tabs (e.g. Messages) open a standalone page, not an inline panel.
    if (def.link) { navigate(def.link); return; }
    const apply = () => { setTab(r.tab); setSub(r.sub); navigate('#' + next, { replace: true }); window.scrollTo(0, 0); };
    // Use View Transition API for smooth tab cross-fade (if supported)
    if (document.startViewTransition) document.startViewTransition(apply);
    else apply();
  };

  // Keep the active tab in sync with the URL (deep links + back/forward).
  useEffect(() => {
    const r = resolveTarget(tabFromLocation());
    const def = visibleTabs.find((t) => t.tab === r.tab);
    // A deep link to a link-out tab (#messages) redirects to its real page so we
    // never render a divergent inline version of it.
    if (def?.link) { navigate(def.link, { replace: true }); return; }
    if (def) { setTab(r.tab); setSub(r.sub); }
    else { setTab('overview'); setSub(undefined); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash, location.search, isOwner, showRental, flagEnabled]);

  const pendingApps = apps.filter((a) => a.status === 'pending').length;

  // ---- Real Overview stats (no fabricated numbers). Owner cards come from the
  // the user's saved/viewed/alert/followed stores. All are honest and, when
  // empty, say so rather than showing a made-up figure. ----
  const totalViews = useMemo(
    () => listings.reduce((s, l) => s + (Number(l.views) || 0), 0),
    [listings],
  );
  const pendingContacts = contactReqs.filter((r) => r.status === 'pending').length;
  const pendingFlatmateReqs = flatmateReqs.filter((r) => r.status === 'pending').length;
  // Photo requests only started having a resolved state when the owner got a way to answer them;
  // before that every row was permanently 'pending' and this filter would have been a no-op dressed
  // up as a rule. It is a real filter now, which is what stops a dealt-with request from sitting in
  // the badge forever and training owners to ignore it.
  const pendingPhotoReqs = photoReqs.filter((r) => r.status === 'pending').length;
  // Buyer document requests, grouped per buyer+property (one due-diligence request =
  // one lead), counting only groups with at least one pending document.
  const docGroups = useMemo(() => buildDocGroups(docReqs), [docReqs]);
  const pendingDocGroups = docGroups.filter((g) => g.pendingIds.length > 0);
  const savedCount = saved.count;
  const alertCount = savedSearches.count;
  // From the context, not a render-body localStorage read (D227): the tile counted a browser-local
  // array, so it disagreed with the same user's count on another device — and with the follower
  // count the society hub shows, which the server computes from rows nothing was writing.
  const followCount = follows.count;
  // Returning-seeker resume: the user's own recent searches (persistent, per-user).
  // Only seekers get the "continue your search" hero; owners have their own flow.
  const recentSearches = isOwner ? [] : getRecentSearches();
  // A real rental only exists if the owner is tracking a rented managed property.
  const rental = managedProps.find((p) => p.rented && p.monthlyRent) || null;
  // Real profile-completion meter (name/email/city + Aadhaar verification).
  const profile = useMemo(() => profileCompletion(user, verified), [user, verified]);

  // ---- Action Center: the single "what's waiting on ME" triage list. Every row is
  // a real request/task that goes stale unless this user responds. Kept as a plain
  // per-render computation (cheap; small arrays) so the inline handlers below are
  // never stale. Sorted stale-first so the oldest, most-at-risk items lead. ----
  const scheduledVisits = useMemo(() => visits.filter((v) => v.status === 'scheduled'), [visits]);
  const payEnabledRent = flagEnabled('onlineRentPayment');
  const actionItems = buildActionItems({
    isOwner, contactReqs, apps, photoReqs, pendingDocGroups, listings, reviewsByProp,
    scheduledVisits, rental, payEnabledRent,
    decideContact, decideApp, go, decideDocReqs, decidePhotoReq, navigate,
  });
  // Counts for the always-visible sidebar/tab badges, so pending work is obvious
  // from any tab — not just Overview. Requests (leads) badge = items genuinely
  // WAITING ON THE OWNER (pending number + photo + flatmate requests), matching
  // the "Waiting on you" figure in the Requests panel. Already-contactable
  // enquiries aren't counted as attention — they need no accept/decline decision.
  const attentionCounts = {
    leads: pendingContacts + pendingPhotoReqs + pendingFlatmateReqs + pendingDocGroups.length,
    visits: scheduledVisits.length,
    messages: chatUnread,
  };

  // Total open leads, computed exactly as the Leads panel computes its own total, so the Overview
  // tile and the panel can never show two different numbers for the same inbox.
  const leadCount = contactReqs.length + photoReqs.length + flatmateReqs.length + docGroups.length;
  const ownerStats = buildOwnerStats({ listings, totalViews, leadCount, pendingContacts, go });
  const seekerStats = buildSeekerStats({ savedCount, recent, alertCount, followCount, go });

  /* Render the active tab directly with the imported panel components. These have
     stable identity across Dashboard re-renders, so a state change here (e.g. a
     contact decision) no longer remounts the active panel and wipes its internal
     state. React remounts only when `tab` changes to a different panel. */
  const renderPanel = () => {
    switch (tab) {
      case 'properties':
        return <MyPropertiesPanel key={'prop:' + (sub || '')} initialSub={sub} isOwner={isOwner} listings={listings} user={user} toast={toast} REVIEW_STATUS={REVIEW_STATUS} openReview={openReview} reviewsByProp={reviewsByProp} />;
      case 'rental':
        return <MyRentalPanel user={user} toast={toast} />;
      case 'activity':
        return <ActivityPanel key={'act:' + (sub || '')} initialSub={sub} recent={recent} />;
      case 'leads':
        return <EnquiriesPanel contactReqs={contactReqs} decideContact={decideContact} photoReqs={photoReqs} decidePhotoReq={decidePhotoReq} flatmateReqs={flatmateReqs} decideFlatmateReq={decideFlatmateReq} docReqs={docReqs} decideDocReqs={decideDocReqs} listings={listings} contactReqsFailed={contactReqsStatus === 'error'} contactReqsError={contactReqsError} onRetryContactReqs={retryContactReqs} photoReqsFailed={photoReqsStatus === 'error'} photoReqsError={photoReqsError} onRetryPhotoReqs={retryPhotoReqs} docReqsFailed={docReqsStatus === 'error'} docReqsError={docReqsError} onRetryDocReqs={retryDocReqs} />;
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
        return <OverviewPanel actionItems={actionItems} isOwner={isOwner} go={go} apps={apps} pendingApps={pendingApps} decideApp={decideApp} toast={toast} recent={recent} recommended={recommended} stats={isOwner ? ownerStats : seekerStats} rental={rental} alertMatches={alertMatches} profile={profile} recentSearches={recentSearches} />;
    }
  };

  return (
    <div className="pt-6 lg:pt-8 pb-20 min-h-[100dvh]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Hi, {firstName(user)} <span className="inline-block">👋</span></h1>
          <p className="text-gray-400 text-sm mt-1">Here's your PuneNest activity.</p>
        </div>

        {/* Mobile section switcher — one row that opens a full sheet of all
            sections, so nothing (and no attention badge) is hidden behind a
            horizontal scroll. Desktop uses the sidebar below instead. */}
        <MobileNav
          tabs={visibleTabs}
          activeTab={tab}
          onSelect={go}
          attentionCounts={attentionCounts}
          user={user}
          onLogout={logout}
          labelFor={(t) => tr('dashboard.tabs.' + t.tab, { defaultValue: t.label })}
        />

        <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-6">
          {/* Sidebar */}
          <DashboardSidebar
            tabs={visibleTabs}
            activeTab={tab}
            onSelect={go}
            attentionCounts={attentionCounts}
            user={user}
            onLogout={logout}
          />

          {/* Content */}
          <section>
            {/* A failed core read is announced above the panels rather than left to be inferred
                from them (D166). It matters more here than anywhere else: `isOwner` is derived
                from `listings`, so an owner whose read failed is silently handed the *tenant*
                dashboard — a wrong product, not just a thin one. */}
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

