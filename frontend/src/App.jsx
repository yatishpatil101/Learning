import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { lazy, Suspense, useEffect, useRef } from 'react';

import ConsumerLayout from './components/layout/ConsumerLayout.jsx';
import AdminLayout from './components/layout/AdminLayout.jsx';
import PreviewBanner from './components/pmf/PreviewBanner.jsx';
import { ProtectedRoute, RoleRoute, FlagRoute, AppFlagRoute, ModuleRoute } from './components/RouteGuards.jsx';
import { AppFlagsProvider } from './context/AppFlagsContext.jsx';
import { lazyPage } from './i18n/lazyPage.js';
import { applyAppPrefs } from './lib/localPrefs.js';
import { track } from './lib/pmf.js';
import { recordPageView, startPageViewBeacon } from './lib/telemetry/pageViewBeacon.js';

import Home from './pages/consumer/Home.jsx';
import Signin from './pages/consumer/Signin.jsx';
import Signup from './pages/consumer/Signup.jsx';
import StaffLogin from './pages/consumer/StaffLogin.jsx';
import Stub from './pages/Stub.jsx';
import HelpLangRoute from './components/help/HelpLangRoute.jsx';

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
const Dashboard = lazyPage(() => import('./pages/consumer/Dashboard.jsx'), 'dashboard', 'flatmates', 'locality', 'owner', 'owner-hub', 'verify');
const Services = lazyPage(() => import('./pages/consumer/Services.jsx'), 'services');
const ListProperty = lazyPage(() => import('./pages/consumer/ListProperty.jsx'), 'flatmates', 'list-property', 'verify');
const PropertyPassport = lazyPage(() => import('./pages/consumer/PropertyPassport.jsx'), 'locality', 'owner-hub');
const PackersMovers = lazyPage(() => import('./pages/consumer/services/PackersMovers.jsx'), 'services');
const PropertyLegal = lazyPage(() => import('./pages/consumer/services/PropertyLegal.jsx'), 'services');
const HomeLoans = lazyPage(() => import('./pages/consumer/services/HomeLoans.jsx'), 'services');
const InteriorRenovation = lazyPage(() => import('./pages/consumer/services/InteriorRenovation.jsx'), 'services');
const PropertyValuation = lazyPage(() => import('./pages/consumer/services/PropertyValuation.jsx'), 'services');
const RentAgreement = lazyPage(() => import('./pages/consumer/services/RentAgreement.jsx'), 'services');
const Contact = lazy(() => import('./pages/consumer/Contact.jsx'));
const Notifications = lazy(() => import('./pages/consumer/Notifications.jsx'));
const Plans = lazy(() => import('./pages/consumer/Plans.jsx'));
const Refer = lazy(() => import('./pages/consumer/Refer.jsx'));
const EmiCalculator = lazy(() => import('./pages/consumer/EmiCalculator.jsx'));
const TenantProfile = lazyPage(() => import('./pages/consumer/TenantProfile.jsx'), 'misc2', 'verify');
const VerifyIdentity = lazyPage(() => import('./pages/consumer/VerifyIdentity.jsx'), 'verify');
const Checkout = lazyPage(() => import('./pages/consumer/Checkout.jsx'), 'misc2');
const ScheduleVisit = lazy(() => import('./pages/consumer/ScheduleVisit.jsx'));
const Society = lazyPage(() => import('./pages/consumer/Society.jsx'), 'list-property', 'property', 'society');
const Societies = lazyPage(() => import('./pages/consumer/Societies.jsx'), 'society');
const Reels = lazyPage(() => import('./pages/consumer/Reels.jsx'), 'reels-docs');
const Saved = lazyPage(() => import('./pages/consumer/Saved.jsx'), 'compare-saved');
// The rent-pay rail was withdrawn: this is a static page describing what is coming, and calls nothing.
const PayRent = lazyPage(() => import('./pages/consumer/PayRentComingSoon.jsx'), 'misc2');
const ViewDocuments = lazyPage(() => import('./pages/consumer/ViewDocuments.jsx'), 'reels-docs');
const Messages = lazyPage(() => import('./pages/consumer/Messages.jsx'), 'misc2');
const Flatmates = lazyPage(() => import('./pages/consumer/Flatmates.jsx'), 'flatmates', 'property', 'verify');
const Locality = lazyPage(() => import('./pages/consumer/Locality.jsx'), 'locality');
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

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'));
const AdminProperties = lazy(() => import('./pages/admin/AdminProperties.jsx'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminServices = lazy(() => import('./pages/admin/AdminServices.jsx'));
const AdminEnquiries = lazy(() => import('./pages/admin/AdminEnquiries.jsx'));
const AdminFinance = lazy(() => import('./pages/admin/AdminFinance.jsx'));
const AdminContent = lazy(() => import('./pages/admin/AdminContent.jsx'));
const AdminReports = lazy(() => import('./pages/admin/AdminReports.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'));
const AdminPostOnBehalf = lazy(() => import('./pages/admin/AdminPostOnBehalf.jsx'));
const AdminStaffActivity = lazy(() => import('./pages/admin/AdminStaffActivity.jsx'));
const AdminSocieties = lazy(() => import('./pages/admin/AdminSocieties.jsx'));
const AdminLocalities = lazy(() => import('./pages/admin/AdminLocalities.jsx'));
/* The only admin route with a locale namespace: the approvals queue was written translated, the
   rest of this page's strings are still English. */
const AdminTeam = lazyPage(() => import('./pages/admin/AdminTeam.jsx'), 'team');

const OpsDashboard = lazy(() => import('./pages/ops/OpsDashboard.jsx'));
const OpsRequests = lazy(() => import('./pages/ops/OpsRequests.jsx'));
const OpsReferrals = lazy(() => import('./pages/ops/OpsReferrals.jsx'));
const OpsFlatmateReview = lazy(() => import('./pages/ops/OpsFlatmateReview.jsx'));
const OpsIdentityReview = lazy(() => import('./pages/ops/OpsIdentityReview.jsx'));
/* These sit here rather than under /admin because their endpoints are staff+admin: the admin group
   is admin+manager, which would lock out the audience the server admits and admit one it refuses. */
const OpsSupportQueue = lazy(() => import('./pages/ops/OpsSupportQueue.jsx'));
const OpsDraftingDesk = lazy(() => import('./pages/ops/OpsDraftingDesk.jsx'));

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
          {/* Permanent redirect: this was the public URL before the rename to Flatmates, so external
              links and search results still point at it. */}
          <Route path="/share-flat" element={<Navigate to="/flatmates" replace />} />
          <Route path="/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
          {/* Registered once per language so a crawler can index all three: serving them from one
              URL hides the Hindi and Marathi articles from search. lib/helpUrl.js owns the prefix
              rule and must stay in step with this list. */}
          {['', '/hi', '/mr'].map((prefix) => (
            <Route key={prefix || 'en'} element={<HelpLangRoute />}>
              <Route path={`${prefix}/help`} element={<HelpHome />} />
              <Route path={`${prefix}/help/search`} element={<HelpSearchResults />} />
              <Route path={`${prefix}/help/faq`} element={<HelpFaq />} />
              <Route path={`${prefix}/help/changelog`} element={<HelpChangelog />} />
              <Route path={`${prefix}/help/c/:categoryId`} element={<HelpCategory />} />
              <Route path={`${prefix}/help/a/:slug`} element={<HelpArticle />} />
            </Route>
          ))}
          {/* Legacy/guessable aliases so /docs and /help-center land somewhere useful. */}
          <Route path="/docs" element={<Navigate to="/help" replace />} />
          <Route path="/help-center" element={<Navigate to="/help" replace />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/refund-policy" element={<RefundPolicy />} />
          <Route path="/disclaimer" element={<Disclaimer />} />
          <Route
            path="/list-property"
            element={
              <ProtectedRoute>
                <ListProperty />
              </ProtectedRoute>
            }
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
            /* The boundary is inside ProtectedRoute on purpose. Outside it, a signed-out
               visitor would be shown a dashboard taking shape for the split second before
               the guard redirects them to /signin — a placeholder implying content they
               have no access to. */
            element={
              <ProtectedRoute>
                <Suspense fallback={<DashboardSkeleton />}>
                  <Dashboard />
                </Suspense>
              </ProtectedRoute>
            }
          />
        </Route>

        {/* Administrators only. Operations staff hold permission atoms too, but those govern what
            the API grants them, not which console they may load; the `ModuleRoute` guards inside
            remain as defence in depth rather than as the only gate. */}
        <Route
          element={
            <RoleRoute roles={['admin']}>
              <AdminLayout variant="admin" />
            </RoleRoute>
          }
        >
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/properties" element={<ModuleRoute moduleKey="properties"><AdminProperties /></ModuleRoute>} />
          <Route path="/admin/analytics" element={<ModuleRoute moduleKey="analytics"><FlagRoute flag="analytics"><AdminAnalytics /></FlagRoute></ModuleRoute>} />
          <Route path="/admin/users" element={<ModuleRoute moduleKey="users"><AdminUsers /></ModuleRoute>} />
          <Route path="/admin/services" element={<ModuleRoute moduleKey="services"><AdminServices /></ModuleRoute>} />
          <Route path="/admin/enquiries" element={<ModuleRoute moduleKey="enquiries"><AdminEnquiries /></ModuleRoute>} />
          <Route path="/admin/finance" element={<ModuleRoute moduleKey="finance"><FlagRoute flag="finance"><AdminFinance /></FlagRoute></ModuleRoute>} />
          <Route path="/admin/content" element={<ModuleRoute moduleKey="content"><AdminContent /></ModuleRoute>} />
          <Route path="/admin/reports" element={<ModuleRoute moduleKey="reports"><FlagRoute flag="reports"><AdminReports /></FlagRoute></ModuleRoute>} />
          <Route path="/admin/support" element={<Navigate to="/admin/services" replace />} />
          {/* Redirects rather than rendering a second desk. The guards stay on the redirect — an
              admin without the Flatmates module should still be refused here, not bounced. */}
          <Route path="/admin/flatmates" element={<ModuleRoute moduleKey="flatmates"><FlagRoute flag="flatmates"><Navigate to="/ops/flatmate-review" replace /></FlagRoute></ModuleRoute>} />
          <Route path="/admin/societies" element={<ModuleRoute moduleKey="societies"><AdminSocieties /></ModuleRoute>} />
          <Route path="/admin/localities" element={<ModuleRoute moduleKey="localities"><AdminLocalities /></ModuleRoute>} />
          <Route path="/admin/team" element={<ModuleRoute moduleKey="team"><AdminTeam /></ModuleRoute>} />
          <Route path="/admin/settings" element={<ModuleRoute moduleKey="settings"><AdminSettings /></ModuleRoute>} />
          <Route path="/admin/post-on-behalf" element={<ModuleRoute moduleKey="postOnBehalf"><AdminPostOnBehalf /></ModuleRoute>} />
          <Route path="/admin/staff-activity" element={<ModuleRoute moduleKey="staffActivity"><AdminStaffActivity /></ModuleRoute>} />
        </Route>

        <Route
          element={
            <RoleRoute roles={['staff', 'admin']}>
              <AdminLayout variant="ops" />
            </RoleRoute>
          }
        >
          <Route path="/ops" element={<OpsDashboard />} />
          <Route path="/ops/requests" element={<OpsRequests />} />
          <Route path="/ops/support" element={<OpsSupportQueue />} />
          <Route path="/ops/drafting-desk" element={<OpsDraftingDesk />} />
          {/* The five team desks are now one `?type=` on the drafting desk. Redirects rather than
              deletions because operators have these bookmarked. */}
          <Route path="/ops/rent-agreement" element={<Navigate to="/ops/drafting-desk?type=rental" replace />} />
          <Route path="/ops/legal" element={<Navigate to="/ops/drafting-desk?type=legal" replace />} />
          <Route path="/ops/interior" element={<Navigate to="/ops/drafting-desk?type=interior" replace />} />
          <Route path="/ops/packers" element={<Navigate to="/ops/drafting-desk?type=packers" replace />} />
          <Route path="/ops/valuation" element={<Navigate to="/ops/drafting-desk?type=valuation" replace />} />
          <Route path="/ops/referrals" element={<OpsReferrals />} />
          <Route path="/ops/flatmate-review" element={<OpsFlatmateReview />} />
          <Route path="/ops/kyc-review" element={<OpsIdentityReview />} />
        </Route>

        <Route element={<ConsumerLayout />}>
          <Route path="*" element={<Stub title="Page not found" phase="Phase 3" />} />
        </Route>
      </Routes>
      </Suspense>
    </>
  );
}
