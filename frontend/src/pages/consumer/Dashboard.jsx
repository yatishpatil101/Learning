import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useSaved } from '../../context/SavedContext.jsx';
import { useSavedSearches } from '../../context/SavedSearchContext.jsx';
import { firstName } from '../../lib/auth.js';
import { useConversationUnread } from '../../context/ConversationContext.jsx';
import { useVerification } from '../../context/VerificationContext.jsx';
import {
  hasListings, getFollowedSocieties,
  getRecentSearches, getTenancies,
} from '../../lib/store.js';
import VisitsTab from '../../components/dashboard/VisitsTab.jsx';
import DocumentsTab from '../../components/dashboard/DocumentsTab.jsx';
import FinancesTab from '../../components/dashboard/FinancesTab.jsx';
import ProfileTab from '../../components/dashboard/ProfileTab.jsx';
import { TABS, TAB_ALIAS, REVIEW_STATUS_MAP } from './dashboard/constants.js';
import { profileCompletion } from './dashboard/retention.js';
import { getMyRooms, getMyFlatmatePosts, getMyFlatmateGroups } from '../../lib/data/myListings.js';
import { getManagedProps } from '../../lib/data/managedProperty.js';
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
  const hasRooms = getMyRooms(user).length > 0;
  const hasRequests = getMyFlatmatePosts(user).length > 0;
  const hasGroups = getMyFlatmateGroups(user).length > 0;
  const hasManaged = getManagedProps().length > 0;
  const ownsInventory = hasRooms || hasRequests || hasGroups || hasManaged;

  /* Loaded here rather than below the tab logic, because `listings` decides whether this user is an
     owner and that decision gates which tabs exist at all.

     `hasListings()` reads the **localStorage** listing store, which holds only what this browser
     posted. Against the API an owner's listings live in the database, so a real owner with real
     inventory answered `false` — and was shown the tenant dashboard, with Finances rendering the
     Rent Wallet instead of their property ledger. It stays in the disjunction for mock mode, where
     the store genuinely is the truth. */
  const {
    listings, enquiries, visits, recent, recommended, alertMatches,
    contactReqs, photoReqs, flatmateReqs, docReqs,
    reviewProp, setReviewProp, reviewInput, setReviewInput,
    apps, decideApp,
    decideContact, decideDocReqs, decideFlatmateReq, mutateVisit, openReview, sendReview,
    dataStatus, dataError, retryData,
    docReqsStatus, docReqsError, retryDocReqs,
    contactReqsStatus, contactReqsError, retryContactReqs,
  } = useDashboardData({ user, toast });
  const isOwner = (listings || []).length > 0 || hasListings() || ownsInventory;
  // "My Rental" (the home you rent) shows for buyers/tenants and anyone with a
  // finalised tenancy — but not for a pure owner who rents nothing.
  const hasTenancy = getTenancies().length > 0;
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
  // Buyer document requests, grouped per buyer+property (one due-diligence request =
  // one lead), counting only groups with at least one pending document.
  const docGroups = useMemo(() => buildDocGroups(docReqs), [docReqs]);
  const pendingDocGroups = docGroups.filter((g) => g.pendingIds.length > 0);
  const savedCount = saved.count;
  const alertCount = savedSearches.count;
  const followCount = getFollowedSocieties().length;
  // Returning-seeker resume: the user's own recent searches (persistent, per-user).
  // Only seekers get the "continue your search" hero; owners have their own flow.
  const recentSearches = isOwner ? [] : getRecentSearches();
  // A real rental only exists if the owner is tracking a rented managed property.
  const rental = getManagedProps().find((p) => p.rented && p.monthlyRent) || null;
  // Real profile-completion meter (name/email/city + Aadhaar verification).
  const profile = useMemo(() => profileCompletion(user, verified), [user, verified]);

  // ---- Action Center: the single "what's waiting on ME" triage list. Every row is
  // a real request/task that goes stale unless this user responds. Kept as a plain
  // per-render computation (cheap; small arrays) so the inline handlers below are
  // never stale. Sorted stale-first so the oldest, most-at-risk items lead. ----
  const scheduledVisits = useMemo(() => visits.filter((v) => v.status === 'scheduled'), [visits]);
  const payEnabledRent = flagEnabled('onlineRentPayment');
  const actionItems = buildActionItems({
    isOwner, contactReqs, apps, photoReqs, pendingDocGroups, listings,
    scheduledVisits, rental, payEnabledRent,
    decideContact, decideApp, go, decideDocReqs, navigate,
  });
  // Counts for the always-visible sidebar/tab badges, so pending work is obvious
  // from any tab — not just Overview. Requests (leads) badge = items genuinely
  // WAITING ON THE OWNER (pending number + photo + flatmate requests), matching
  // the "Waiting on you" figure in the Requests panel. Already-contactable
  // enquiries aren't counted as attention — they need no accept/decline decision.
  const attentionCounts = {
    leads: pendingContacts + photoReqs.length + pendingFlatmateReqs + pendingDocGroups.length,
    visits: scheduledVisits.length,
    messages: chatUnread,
  };

  const ownerStats = buildOwnerStats({ listings, totalViews, enquiries, pendingContacts, go });
  const seekerStats = buildSeekerStats({ savedCount, recent, alertCount, followCount, go });

  /* Render the active tab directly with the imported panel components. These have
     stable identity across Dashboard re-renders, so a state change here (e.g. a
     contact decision) no longer remounts the active panel and wipes its internal
     state. React remounts only when `tab` changes to a different panel. */
  const renderPanel = () => {
    switch (tab) {
      case 'properties':
        return <MyPropertiesPanel key={'prop:' + (sub || '')} initialSub={sub} isOwner={isOwner} listings={listings} user={user} toast={toast} REVIEW_STATUS={REVIEW_STATUS} openReview={openReview} />;
      case 'rental':
        return <MyRentalPanel user={user} toast={toast} />;
      case 'activity':
        return <ActivityPanel key={'act:' + (sub || '')} initialSub={sub} recent={recent} />;
      case 'leads':
        return <EnquiriesPanel contactReqs={contactReqs} decideContact={decideContact} enquiries={enquiries} photoReqs={photoReqs} flatmateReqs={flatmateReqs} decideFlatmateReq={decideFlatmateReq} docReqs={docReqs} decideDocReqs={decideDocReqs} listings={listings} contactReqsFailed={contactReqsStatus === 'error'} contactReqsError={contactReqsError} onRetryContactReqs={retryContactReqs} docReqsFailed={docReqsStatus === 'error'} docReqsError={docReqsError} onRetryDocReqs={retryDocReqs} />;
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
        return <OverviewPanel actionItems={actionItems} isOwner={isOwner} listings={listings} enquiries={enquiries} visits={visits} go={go} apps={apps} pendingApps={pendingApps} decideApp={decideApp} toast={toast} recent={recent} recommended={recommended} stats={isOwner ? ownerStats : seekerStats} rental={rental} alertMatches={alertMatches} profile={profile} recentSearches={recentSearches} />;
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
        reviewInput={reviewInput}
        setReviewInput={setReviewInput}
        sendReview={sendReview}
        REVIEW_STATUS={REVIEW_STATUS}
      />
    </div>
  );
}

