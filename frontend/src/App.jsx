import { Navigate, Route, Routes, useLocation, useNavigationType, useRoutes } from 'react-router';
import { lazy, Suspense, useEffect, useRef } from 'react';

import ConsumerLayout from './components/layout/ConsumerLayout.jsx';
import AdminLayout from './components/layout/AdminLayout.jsx';
import PreviewBanner from './components/pmf/PreviewBanner.jsx';
import { ProtectedRoute, RoleRoute, FlagRoute, AppFlagRoute, ModuleRoute } from './components/RouteGuards.jsx';
import { AppFlagsProvider } from './context/AppFlagsContext.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { lazyPage } from './i18n/lazyPage.js';
import { applyAppPrefs } from './lib/localPrefs.js';
import { DESK_BY_VALUE, portalBase, portalPath } from './lib/adminModules.js';
import { track } from './lib/pmf.js';
import { recordPageView, startPageViewBeacon } from './lib/telemetry/pageViewBeacon.js';

import Home from './pages/consumer/Home.jsx';
import Signin from './pages/consumer/Signin.jsx';
import Signup from './pages/consumer/Signup.jsx';
import StaffLogin from './pages/consumer/StaffLogin.jsx';
import Stub from './pages/Stub.jsx';
import LegacyHelpLangRedirect from './components/help/LegacyHelpLangRedirect.jsx';

/* Route-shaped Suspense fallbacks, necessarily in the entry chunk. They must stay free of imports
   of their own or they drag a route's dependencies into the critical path. */
import DashboardSkeleton from './pages/consumer/dashboard/DashboardSkeleton.jsx';
import FlatmatesSkeleton from './pages/consumer/flatmates/FlatmatesSkeleton.jsx';
import SocietySkeleton from './pages/consumer/society/SocietySkeleton.jsx';

/* `lazyPage(loader, ...namespaces)` is `lazy()` plus the route's English locale namespaces, so English
   is not bundled whole onto every visitor's critical path. `npm run check:i18n` proves the list. */
const Listings = lazyPage(() => import('./pages/consumer/Listings.jsx'), 'listings', 'owner', 'property', 'verify');
const Property = lazyPage(() => import('./pages/consumer/Property.jsx'), 'listings', 'owner', 'property', 'verify');
const Owner = lazyPage(() => import('./pages/consumer/Owner.jsx'), 'owner');
const Compare = lazyPage(() => import('./pages/consumer/Compare.jsx'), 'compare-saved');
const Dashboard = lazyPage(() => import('./pages/consumer/Dashboard.jsx'), 'dashboard', 'flatmates', 'listings', 'locality', 'owner', 'owner-hub', 'verify');
const Services = lazyPage(() => import('./pages/consumer/Services.jsx'), 'services');
const ListProperty = lazyPage(() => import('./pages/consumer/ListProperty.jsx'), 'flatmates', 'list-property', 'owner', 'verify');
const PropertyPassport = lazyPage(() => import('./pages/consumer/PropertyPassport.jsx'), 'locality', 'owner-hub');
const PackersMovers = lazyPage(() => import('./pages/consumer/services/PackersMovers.jsx'), 'services');
const PropertyLegal = lazyPage(() => import('./pages/consumer/services/PropertyLegal.jsx'), 'services');
const HomeLoans = lazyPage(() => import('./pages/consumer/services/HomeLoans.jsx'), 'services');
const InteriorRenovation = lazyPage(() => import('./pages/consumer/services/InteriorRenovation.jsx'), 'services');
const PropertyValuation = lazyPage(() => import('./pages/consumer/services/PropertyValuation.jsx'), 'services');
const RentAgreement = lazyPage(() => import('./pages/consumer/services/RentAgreement.jsx'), 'list-property', 'services');
const Contact = lazy(() => import('./pages/consumer/Contact.jsx'));
const StaffInvite = lazy(() => import('./pages/consumer/StaffInvite.jsx'));
const Notifications = lazy(() => import('./pages/consumer/Notifications.jsx'));
const Plans = lazy(() => import('./pages/consumer/Plans.jsx'));
const Refer = lazy(() => import('./pages/consumer/Refer.jsx'));
const EmiCalculator = lazy(() => import('./pages/consumer/EmiCalculator.jsx'));
const TenantProfile = lazyPage(() => import('./pages/consumer/TenantProfile.jsx'), 'misc2', 'verify');
const VerifyIdentity = lazyPage(() => import('./pages/consumer/VerifyIdentity.jsx'), 'verify-identity');
const Checkout = lazyPage(() => import('./pages/consumer/Checkout.jsx'), 'misc2');
const ScheduleVisit = lazy(() => import('./pages/consumer/ScheduleVisit.jsx'));
const Society = lazyPage(() => import('./pages/consumer/Society.jsx'), 'list-property', 'property', 'society');
const Societies = lazyPage(() => import('./pages/consumer/Societies.jsx'), 'society');
const Reels = lazyPage(() => import('./pages/consumer/Reels.jsx'), 'compare-saved', 'reels-docs');
const Saved = lazyPage(() => import('./pages/consumer/Saved.jsx'), 'compare-saved', 'flatmates', 'listings');
// Static teaser only: keep this route free of payment calls until the rail is live.
const PayRent = lazyPage(() => import('./pages/consumer/PayRentComingSoon.jsx'), 'misc2');
const ViewDocuments = lazyPage(() => import('./pages/consumer/ViewDocuments.jsx'), 'reels-docs');
const Messages = lazyPage(() => import('./pages/consumer/Messages.jsx'), 'flatmates', 'misc2');
const Flatmates = lazyPage(() => import('./pages/consumer/Flatmates.jsx'), 'flatmates', 'owner', 'property', 'verify');
const FlatmateDetail = lazyPage(() => import('./pages/consumer/FlatmateDetail.jsx'), 'flatmates', 'owner', 'property');
const Locality = lazyPage(() => import('./pages/consumer/Locality.jsx'), 'listings', 'locality');
const Support = lazyPage(() => import('./pages/consumer/Support.jsx'), 'misc2');
const HelpHome = lazy(() => import('./pages/consumer/help/HelpHome.jsx'));
const HelpCategory = lazy(() => import('./pages/consumer/help/HelpCategory.jsx'));
const HelpArticle = lazy(() => import('./pages/consumer/help/HelpArticle.jsx'));
const HelpSearchResults = lazy(() => import('./pages/consumer/help/HelpSearchResults.jsx'));
const HelpFaq = lazy(() => import('./pages/consumer/help/HelpFaq.jsx'));
const HelpChangelog = lazy(() => import('./pages/consumer/help/HelpChangelog.jsx'));
const Privacy = lazy(() => import('./pages/consumer/Privacy.jsx'));
const Terms = lazy(() => import('./pages/consumer/Terms.jsx'));
const RefundPolicy = lazy(() => import('./pages/consumer/RefundPolicy.jsx'));
const Disclaimer = lazy(() => import('./pages/consumer/Disclaimer.jsx'));

function ListPropertyRoute() {
  const location = useLocation();
  const editing = new URLSearchParams(location.search).has('edit');
  const page = <ListProperty />;
  return editing ? <ProtectedRoute>{page}</ProtectedRoute> : page;
}

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'));
const AdminProperties = lazy(() => import('./pages/admin/AdminProperties.jsx'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminServices = lazy(() => import('./pages/admin/AdminServices.jsx'));
const DeskWithTickets = lazy(() => import('./pages/admin/DeskWithTickets.jsx'));
const AdminEnquiries = lazy(() => import('./pages/admin/AdminEnquiries.jsx'));
const AdminFinance = lazy(() => import('./pages/admin/AdminFinance.jsx'));
const AdminContent = lazy(() => import('./pages/admin/AdminContent.jsx'));
const AdminReports = lazy(() => import('./pages/admin/AdminReports.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'));
const AdminPostOnBehalf = lazyPage(() => import('./pages/admin/AdminPostOnBehalf.jsx'), 'list-property');
const AdminStaffActivity = lazy(() => import('./pages/admin/AdminStaffActivity.jsx'));
const AdminSocieties = lazy(() => import('./pages/admin/AdminSocieties.jsx'));
const AdminLocalities = lazy(() => import('./pages/admin/AdminLocalities.jsx'));
/* The manager warning owns the only translated string on this page; the rest is still English. */
const AdminTeam = lazyPage(() => import('./pages/admin/AdminTeam.jsx'), 'team');

const OpsReferrals = lazy(() => import('./pages/ops/OpsReferrals.jsx'));
const OpsFlatmateReview = lazy(() => import('./pages/ops/OpsFlatmateReview.jsx'));
const OpsIdentityReview = lazy(() => import('./pages/ops/OpsIdentityReview.jsx'));
const OpsSupportQueue = lazy(() => import('./pages/ops/OpsSupportQueue.jsx'));
const OpsDraftingDesk = lazy(() => import('./pages/ops/OpsDraftingDesk.jsx'));
const RentAgreementDesk = lazy(() => import('./pages/ops/rent-agreement/RentAgreementDesk.jsx'));

function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  // Async content and reveal animations land a restored scroll position part-way down the page,
  // so force the top on reload. Genuine back/forward (POP) is left alone.
  useEffect(() => {
    const navEntry = performance.getEntriesByType?.('navigation')?.[0];
    if (navEntry?.type === 'reload') window.scrollTo(0, 0);
  }, []);
  // Pathname-only, so a `?tab=` switch does not yank the reader back to the top; POP is still
  // gated so the browser can restore its own position.
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (pathname === prevPath.current) return;
    prevPath.current = pathname;
    if (navType !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navType]);
  // PMF funnel: log a page_view on every route change (no-op unless flag on).
  useEffect(() => { track('page_view', { path: pathname }); }, [pathname]);
  return null;
}

/* Separate from `ScrollToTop` because it is permanent and sends to our own API. The beacon reduces
   the pathname to a pattern and never emits back-office routes. */
function PageViewTelemetry() {
  const { pathname } = useLocation();

  // Mounted once, separate from the effect below: restarting the interval on every route change
  // would mean a fast-browsing session never flushes until the queue cap or a hidden tab.
  useEffect(() => startPageViewBeacon(), []);

  useEffect(() => { recordPageView(pathname); }, [pathname]);
  return null;
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-teal-400/30 border-t-teal-400 rounded-full animate-spin" />
    </div>
  );
}

// Old /ops bookmarks carry ?open=<id> and similar; the target's own query wins on a clash.
function LegacyRedirect({ to }) {
  const { search, hash } = useLocation();
  const [pathname, fixed = ''] = to.split('?');
  const params = new URLSearchParams(search);
  new URLSearchParams(fixed).forEach((value, key) => params.set(key, value));
  const query = params.toString();
  return <Navigate to={`${pathname}${query ? `?${query}` : ''}${hash}`} replace />;
}

// Old `?type=` bookmarks land on that desk's own page.
function DeskRedirect() {
  const { search } = useLocation();
  return <Navigate to={DESK_BY_VALUE[new URLSearchParams(search).get('type')]?.path || '/admin'} replace />;
}

function PortalHome() {
  const { user } = useAuth();
  return <Navigate to={portalBase(user)} replace />;
}

/* Mounted under both /admin/* and /staff/*. Route objects rather than <Route> elements because these
   paths are relative to the mount, and back-office views are never collected (`isBackOffice`). */
const BACK_OFFICE_ROUTES = [{
  element: <AdminLayout />,
  children: [
    { index: true, element: <AdminDashboard /> },
    { path: 'kyc-review', element: <ModuleRoute moduleKey="kycReview"><OpsIdentityReview /></ModuleRoute> },
    { path: 'properties', element: <ModuleRoute moduleKey="properties"><AdminProperties /></ModuleRoute> },
    { path: 'analytics', element: <ModuleRoute moduleKey="analytics"><FlagRoute flag="analytics"><AdminAnalytics /></FlagRoute></ModuleRoute> },
    { path: 'users', element: <ModuleRoute moduleKey="users"><AdminUsers /></ModuleRoute> },
    { path: 'rent-agreement', element: <ModuleRoute moduleKey="desk:rental"><DeskWithTickets desk="rental"><RentAgreementDesk /></DeskWithTickets></ModuleRoute> },
    { path: 'home-loans', element: <ModuleRoute moduleKey="desk:loans"><AdminServices desk="loans" /></ModuleRoute> },
    { path: 'legal', element: <ModuleRoute moduleKey="desk:legal"><DeskWithTickets desk="legal"><OpsDraftingDesk key="legal" desk="legal" /></DeskWithTickets></ModuleRoute> },
    { path: 'interior', element: <ModuleRoute moduleKey="desk:interior"><DeskWithTickets desk="interior"><OpsDraftingDesk key="interior" desk="interior" /></DeskWithTickets></ModuleRoute> },
    { path: 'packers', element: <ModuleRoute moduleKey="desk:packers"><DeskWithTickets desk="packers"><OpsDraftingDesk key="packers" desk="packers" /></DeskWithTickets></ModuleRoute> },
    { path: 'valuation', element: <ModuleRoute moduleKey="desk:valuation"><DeskWithTickets desk="valuation"><OpsDraftingDesk key="valuation" desk="valuation" /></DeskWithTickets></ModuleRoute> },
    { path: 'drafting-desk', element: <DeskRedirect /> },
    { path: 'support', element: <ModuleRoute moduleKey="support"><OpsSupportQueue /></ModuleRoute> },
    { path: 'enquiries', element: <ModuleRoute moduleKey="enquiries"><AdminEnquiries /></ModuleRoute> },
    { path: 'referrals', element: <ModuleRoute moduleKey="referrals"><OpsReferrals /></ModuleRoute> },
    { path: 'finance', element: <ModuleRoute moduleKey="finance"><FlagRoute flag="finance"><AdminFinance /></FlagRoute></ModuleRoute> },
    { path: 'content', element: <ModuleRoute moduleKey="content"><AdminContent /></ModuleRoute> },
    { path: 'reports', element: <ModuleRoute moduleKey="reports"><FlagRoute flag="reports"><AdminReports /></FlagRoute></ModuleRoute> },
    { path: 'flatmates', element: <ModuleRoute moduleKey="flatmates"><FlagRoute flag="flatmates"><OpsFlatmateReview /></FlagRoute></ModuleRoute> },
    { path: 'societies', element: <ModuleRoute moduleKey="societies"><AdminSocieties /></ModuleRoute> },
    { path: 'localities', element: <ModuleRoute moduleKey="localities"><AdminLocalities /></ModuleRoute> },
    { path: 'team', element: <ModuleRoute moduleKey="team"><AdminTeam /></ModuleRoute> },
    { path: 'settings', element: <ModuleRoute moduleKey="settings"><AdminSettings /></ModuleRoute> },
    { path: 'post-on-behalf', element: <ModuleRoute moduleKey="postOnBehalf"><AdminPostOnBehalf /></ModuleRoute> },
    { path: 'staff-activity', element: <ModuleRoute moduleKey="staffActivity"><AdminStaffActivity /></ModuleRoute> },
    { path: '*', element: <PortalHome /> },
  ],
}];

// Each role has one prefix: a link written as /admin/x lands a staff member on /staff/x, and back.
function BackOffice() {
  const { user } = useAuth();
  const { pathname, search, hash } = useLocation();
  const routes = useRoutes(BACK_OFFICE_ROUTES);
  const target = portalPath(user, pathname);
  return target === pathname ? routes : <Navigate to={`${target}${search}${hash}`} replace />;
}

export default function App() {
  // Apply saved appearance prefs (e.g. Reduce motion) to <html> once on load so
  // the choice persists across sessions and route changes before any page mounts.
  useEffect(() => { applyAppPrefs(); }, []);
  return (
    <>
      <PreviewBanner />
      <ScrollToTop />
      <PageViewTelemetry />
      <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Standalone full-screen secure viewer (own chrome, no consumer nav) */}
        <Route path="/view-documents/:requestId" element={<ProtectedRoute><ViewDocuments /></ProtectedRoute>} />
        <Route path="/verify-identity" element={<ProtectedRoute><AppFlagsProvider><AppFlagRoute flag="kycBadgeEnabled"><VerifyIdentity /></AppFlagRoute></AppFlagsProvider></ProtectedRoute>} />
        {/* Public by design: the token in the URL fragment IS the credential, and the recipient has
            no account. The fragment never reaches a server — the token travels on `X-Share-Token`. */}
        <Route path="/shared-documents" element={<ViewDocuments shared />} />
        <Route element={<ConsumerLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/listings" element={<Listings />} />
          <Route path="/property/:id" element={<Property />} />
          <Route path="/owner/:id" element={<Owner />} />
          <Route path="/compare" element={<AppFlagRoute flag="compareProperties"><Compare /></AppFlagRoute>} />
          <Route path="/signin" element={<Signin />} />
          <Route path="/signup" element={<AppFlagRoute flag="signupsEnabled"><Signup /></AppFlagRoute>} />
          <Route path="/staff-login" element={<StaffLogin />} />
          <Route path="/staff-invite" element={<StaffInvite />} />
          <Route path="/services" element={<Services />} />
          {/* Public service landing pages — anyone can browse; sign-in is enforced only at the
              "use the service" action (quote submit / generate / book) inside each page. */}
          <Route path="/services/packers-movers" element={<PackersMovers />} />
          <Route path="/services/property-legal" element={<PropertyLegal />} />
          <Route path="/home-loans" element={<HomeLoans />} />
          <Route path="/services/interior-renovation" element={<InteriorRenovation />} />
          <Route path="/services/property-valuation" element={<PropertyValuation />} />
          <Route path="/services/rent-agreement" element={<RentAgreement />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/refer" element={<ProtectedRoute><Refer /></ProtectedRoute>} />
          <Route path="/emi-calculator" element={<AppFlagRoute flag="emiCalculator"><EmiCalculator /></AppFlagRoute>} />
          <Route path="/tenant-profile" element={<ProtectedRoute><TenantProfile /></ProtectedRoute>} />
          <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
          <Route path="/schedule-visit" element={<AppFlagRoute flag="scheduleVisit"><ProtectedRoute><ScheduleVisit /></ProtectedRoute></AppFlagRoute>} />
          <Route path="/societies" element={<Societies />} />
          {/* Own boundary so the outer centred spinner never covers this route: the society page
              opens on a 224–288px hero, so the swap would shunt everything below it downward. */}
          <Route path="/society" element={<AppFlagRoute flag="societySaaS"><Suspense fallback={<SocietySkeleton />}><Society /></Suspense></AppFlagRoute>} />
          <Route path="/society/:slug" element={<Suspense fallback={<SocietySkeleton />}><Society /></Suspense>} />
          <Route path="/reels" element={<Reels />} />
          {/* No auth wall: saves live in localStorage and several surfaces write them while signed
              out, so a guard here made the bottom nav's Saved tab a dead end for those users. */}
          <Route path="/saved" element={<AppFlagRoute flag="savedListings"><Saved /></AppFlagRoute>} />
          <Route path="/pay-rent" element={<ProtectedRoute><PayRent /></ProtectedRoute>} />
          <Route path="/locality" element={<Locality />} />
          <Route path="/locality/:slug" element={<Locality />} />
          <Route path="/map" element={<Navigate to="/listings?view=map" replace />} />
          <Route path="/messages" element={<AppFlagRoute flag="inAppMessaging"><ProtectedRoute><Messages /></ProtectedRoute></AppFlagRoute>} />
          {/* Same reasoning as /society: hero, filter deck and first card row arrive together, so a
              centred spinner guarantees a reflow as someone reaches for the List/Map toggle. */}
          <Route path="/flatmates" element={<Suspense fallback={<FlatmatesSkeleton />}><Flatmates /></Suspense>} />
          <Route path="/flatmates/:kind/:id" element={<FlatmateDetail />} />
          {/* Permanent redirect for legacy external links and search results. */}
          <Route path="/share-flat" element={<Navigate to="/flatmates" replace />} />
          <Route path="/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
          <Route path="/help" element={<HelpHome />} />
          <Route path="/help/search" element={<HelpSearchResults />} />
          <Route path="/help/faq" element={<HelpFaq />} />
          <Route path="/help/changelog" element={<HelpChangelog />} />
          <Route path="/help/c/:categoryId" element={<HelpCategory />} />
          <Route path="/help/a/:slug" element={<HelpArticle />} />
          <Route path="/hi/help/*" element={<LegacyHelpLangRedirect />} />
          <Route path="/mr/help/*" element={<LegacyHelpLangRedirect />} />
          {/* Legacy/guessable aliases so /docs and /help-center land somewhere useful. */}
          <Route path="/docs" element={<Navigate to="/help" replace />} />
          <Route path="/help-center" element={<Navigate to="/help" replace />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/refund-policy" element={<RefundPolicy />} />
          <Route path="/disclaimer" element={<Disclaimer />} />
          <Route
            path="/list-property"
            element={<ListPropertyRoute />}
          />
          <Route
            path="/owner-hub"
            element={<Navigate to="/dashboard#owner-hub" replace />}
          />
          <Route
            path="/owner-hub/property/:id"
            element={
              <ProtectedRoute>
                <PropertyPassport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            /** ProtectedRoute wraps Suspense so signed-out users never see dashboard chrome. */
            element={
              <ProtectedRoute>
                <Suspense fallback={<DashboardSkeleton />}>
                  <Dashboard />
                </Suspense>
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="/admin/*" element={<RoleRoute roles={['staff', 'manager', 'admin']}><BackOffice /></RoleRoute>} />
        <Route path="/staff/*" element={<RoleRoute roles={['staff', 'manager', 'admin']}><BackOffice /></RoleRoute>} />

        <Route path="/ops" element={<LegacyRedirect to="/admin" />} />
        <Route path="/ops/support" element={<LegacyRedirect to="/admin/support" />} />
        <Route path="/ops/drafting-desk" element={<DeskRedirect />} />
        <Route path="/ops/rent-agreement" element={<LegacyRedirect to="/admin/rent-agreement" />} />
        <Route path="/ops/legal" element={<LegacyRedirect to="/admin/legal" />} />
        <Route path="/ops/interior" element={<LegacyRedirect to="/admin/interior" />} />
        <Route path="/ops/packers" element={<LegacyRedirect to="/admin/packers" />} />
        <Route path="/ops/valuation" element={<LegacyRedirect to="/admin/valuation" />} />
        <Route path="/ops/referrals" element={<LegacyRedirect to="/admin/referrals" />} />
        <Route path="/ops/flatmate-review" element={<LegacyRedirect to="/admin/flatmates" />} />
        <Route path="/ops/kyc-review" element={<LegacyRedirect to="/admin/kyc-review" />} />
        <Route path="/ops/*" element={<LegacyRedirect to="/admin" />} />

        <Route element={<ConsumerLayout />}>
          <Route path="*" element={<Stub title="Page not found" phase="Phase 3" />} />
        </Route>
      </Routes>
      </Suspense>
    </>
  );
}
