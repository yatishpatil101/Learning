import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { lazy, Suspense, useEffect, useRef } from 'react';

import ConsumerLayout from './components/layout/ConsumerLayout.jsx';
import AdminLayout from './components/layout/AdminLayout.jsx';
import { ProtectedRoute, RoleRoute, TeamRoute, FlagRoute, AppFlagRoute, ModuleRoute } from './components/RouteGuards.jsx';
import { applyAppPrefs } from './lib/store.js';

/* ─── Synchronous imports (critical path — needed immediately) ─── */
import Home from './pages/consumer/Home.jsx';
import Signin from './pages/consumer/Signin.jsx';
import Signup from './pages/consumer/Signup.jsx';
import StaffLogin from './pages/consumer/StaffLogin.jsx';
import Stub from './pages/Stub.jsx';

/* ─── Lazy consumer pages (loaded on navigation) ─── */
const Listings = lazy(() => import('./pages/consumer/Listings.jsx'));
const Property = lazy(() => import('./pages/consumer/Property.jsx'));
const Owner = lazy(() => import('./pages/consumer/Owner.jsx'));
const Compare = lazy(() => import('./pages/consumer/Compare.jsx'));
const Dashboard = lazy(() => import('./pages/consumer/Dashboard.jsx'));
const DevSeed = lazy(() => import('./pages/consumer/DevSeed.jsx'));
const Services = lazy(() => import('./pages/consumer/Services.jsx'));
const ListProperty = lazy(() => import('./pages/consumer/ListProperty.jsx'));
const PropertyPassport = lazy(() => import('./pages/consumer/PropertyPassport.jsx'));
const PackersMovers = lazy(() => import('./pages/consumer/services/PackersMovers.jsx'));
const PropertyLegal = lazy(() => import('./pages/consumer/services/PropertyLegal.jsx'));
const HomeLoans = lazy(() => import('./pages/consumer/services/HomeLoans.jsx'));
const InteriorRenovation = lazy(() => import('./pages/consumer/services/InteriorRenovation.jsx'));
const PropertyValuation = lazy(() => import('./pages/consumer/services/PropertyValuation.jsx'));
const RentAgreement = lazy(() => import('./pages/consumer/services/RentAgreement.jsx'));
const Contact = lazy(() => import('./pages/consumer/Contact.jsx'));
const Notifications = lazy(() => import('./pages/consumer/Notifications.jsx'));
const Plans = lazy(() => import('./pages/consumer/Plans.jsx'));
const Refer = lazy(() => import('./pages/consumer/Refer.jsx'));
const EmiCalculator = lazy(() => import('./pages/consumer/EmiCalculator.jsx'));
const TenantProfile = lazy(() => import('./pages/consumer/TenantProfile.jsx'));
const Checkout = lazy(() => import('./pages/consumer/Checkout.jsx'));
const ScheduleVisit = lazy(() => import('./pages/consumer/ScheduleVisit.jsx'));
const Society = lazy(() => import('./pages/consumer/Society.jsx'));
const Societies = lazy(() => import('./pages/consumer/Societies.jsx'));
const Reels = lazy(() => import('./pages/consumer/Reels.jsx'));
const Saved = lazy(() => import('./pages/consumer/Saved.jsx'));
const PayRent = lazy(() => import('./pages/consumer/PayRent.jsx'));
const ViewDocuments = lazy(() => import('./pages/consumer/ViewDocuments.jsx'));
const Messages = lazy(() => import('./pages/consumer/Messages.jsx'));
const ShareFlat = lazy(() => import('./pages/consumer/ShareFlat.jsx'));
const Locality = lazy(() => import('./pages/consumer/Locality.jsx'));
const Support = lazy(() => import('./pages/consumer/Support.jsx'));
const Privacy = lazy(() => import('./pages/consumer/Privacy.jsx'));
const Terms = lazy(() => import('./pages/consumer/Terms.jsx'));
const RefundPolicy = lazy(() => import('./pages/consumer/RefundPolicy.jsx'));
const Disclaimer = lazy(() => import('./pages/consumer/Disclaimer.jsx'));

/* ─── Lazy admin pages ─── */
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'));
const AdminProperties = lazy(() => import('./pages/admin/AdminProperties.jsx'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminServices = lazy(() => import('./pages/admin/AdminServices.jsx'));
const AdminEnquiries = lazy(() => import('./pages/admin/AdminEnquiries.jsx'));
const AdminFinance = lazy(() => import('./pages/admin/AdminFinance.jsx'));
const AdminContent = lazy(() => import('./pages/admin/AdminContent.jsx'));
const AdminReports = lazy(() => import('./pages/admin/AdminReports.jsx'));
// AdminSupport merged into AdminServices — route redirects
const AdminFlatmates = lazy(() => import('./pages/admin/AdminFlatmates.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'));
const AdminPostOnBehalf = lazy(() => import('./pages/admin/AdminPostOnBehalf.jsx'));
const AdminStaffActivity = lazy(() => import('./pages/admin/AdminStaffActivity.jsx'));
const AdminSocieties = lazy(() => import('./pages/admin/AdminSocieties.jsx'));
const AdminLocalities = lazy(() => import('./pages/admin/AdminLocalities.jsx'));
const AdminTeam = lazy(() => import('./pages/admin/AdminTeam.jsx'));

/* ─── Lazy ops pages ─── */
const OpsDashboard = lazy(() => import('./pages/ops/OpsDashboard.jsx'));
const OpsRequests = lazy(() => import('./pages/ops/OpsRequests.jsx'));
const OpsRentAgreement = lazy(() => import('./pages/ops/OpsRentAgreement.jsx'));
const OpsLegal = lazy(() => import('./pages/ops/OpsLegal.jsx'));
const OpsInterior = lazy(() => import('./pages/ops/OpsInterior.jsx'));
const OpsPackers = lazy(() => import('./pages/ops/OpsPackers.jsx'));
const OpsValuation = lazy(() => import('./pages/ops/OpsValuation.jsx'));
const OpsReferrals = lazy(() => import('./pages/ops/OpsReferrals.jsx'));
const OpsShareReview = lazy(() => import('./pages/ops/OpsShareReview.jsx'));

function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  // On a full-page reload, browsers restore the previous scroll position. With
  // this SPA's async content (Featured fetch, images) + reveal animations, that
  // lands the page partially scrolled. main.jsx disables restoration on reload;
  // this forces the top as a safety net. Genuine back/forward (POP) is left
  // alone so the browser can restore its scroll position.
  useEffect(() => {
    const navEntry = performance.getEntriesByType?.('navigation')?.[0];
    if (navEntry?.type === 'reload') window.scrollTo(0, 0);
  }, []);
  // Scroll to top only when the pathname actually changes (a real page
  // navigation). Search-param-only updates — e.g. the `?tab=` switches on the
  // property/society detail pages — keep the same pathname and must NOT reset
  // scroll, otherwise clicking a section tab yanks the reader back to the top.
  // navType still gates POP (back/forward) so the browser can restore position.
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (pathname === prevPath.current) return;
    prevPath.current = pathname;
    if (navType !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navType]);
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
      <ScrollToTop />
      <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Standalone full-screen secure viewer (own chrome, no consumer nav) */}
        <Route path="/view-documents" element={<ProtectedRoute><ViewDocuments /></ProtectedRoute>} />
        {/* Consumer */}
        <Route element={<ConsumerLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/listings" element={<Listings />} />
          <Route path="/property/:id" element={<Property />} />
          <Route path="/owner/:id" element={<Owner />} />
          <Route path="/compare" element={<AppFlagRoute flag="compareProperties"><Compare /></AppFlagRoute>} />
          <Route path="/signin" element={<Signin />} />
          <Route path="/signup" element={<AppFlagRoute flag="signupsEnabled"><Signup /></AppFlagRoute>} />
          <Route path="/staff-login" element={<StaffLogin />} />
          <Route path="/dev-seed" element={<DevSeed />} />
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
          <Route path="/society" element={<AppFlagRoute flag="societySaaS"><Society /></AppFlagRoute>} />
          <Route path="/society/:slug" element={<Society />} />
          <Route path="/reels" element={<Reels />} />
          <Route path="/saved" element={<AppFlagRoute flag="savedListings"><ProtectedRoute><Saved /></ProtectedRoute></AppFlagRoute>} />
          <Route path="/pay-rent" element={<ProtectedRoute><PayRent /></ProtectedRoute>} />
          <Route path="/locality" element={<Locality />} />
          <Route path="/locality/:slug" element={<Locality />} />
          <Route path="/map" element={<Navigate to="/listings?view=map" replace />} />
          <Route path="/messages" element={<AppFlagRoute flag="inAppMessaging"><ProtectedRoute><Messages /></ProtectedRoute></AppFlagRoute>} />
          <Route path="/share-flat" element={<ShareFlat />} />
          <Route path="/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
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
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
        </Route>

        {/* Admin (role: admin or scoped manager) */}
        <Route
          element={
            <RoleRoute roles={['admin', 'manager']}>
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
          <Route path="/admin/flatmates" element={<ModuleRoute moduleKey="flatmates"><FlagRoute flag="flatmates"><AdminFlatmates /></FlagRoute></ModuleRoute>} />
          <Route path="/admin/societies" element={<ModuleRoute moduleKey="societies"><AdminSocieties /></ModuleRoute>} />
          <Route path="/admin/localities" element={<ModuleRoute moduleKey="localities"><AdminLocalities /></ModuleRoute>} />
          <Route path="/admin/team" element={<ModuleRoute moduleKey="team"><AdminTeam /></ModuleRoute>} />
          <Route path="/admin/settings" element={<ModuleRoute moduleKey="settings"><AdminSettings /></ModuleRoute>} />
          <Route path="/admin/post-on-behalf" element={<ModuleRoute moduleKey="postOnBehalf"><AdminPostOnBehalf /></ModuleRoute>} />
          <Route path="/admin/staff-activity" element={<ModuleRoute moduleKey="staffActivity"><AdminStaffActivity /></ModuleRoute>} />
        </Route>

        {/* Ops (role: staff or admin) */}
        <Route
          element={
            <RoleRoute roles={['staff', 'admin']}>
              <AdminLayout variant="ops" />
            </RoleRoute>
          }
        >
          <Route path="/ops" element={<OpsDashboard />} />
          <Route path="/ops/requests" element={<OpsRequests />} />
          <Route path="/ops/rent-agreement" element={<TeamRoute team="rental"><OpsRentAgreement /></TeamRoute>} />
          <Route path="/ops/legal" element={<TeamRoute team="legal"><OpsLegal /></TeamRoute>} />
          <Route path="/ops/interior" element={<TeamRoute team="interior"><OpsInterior /></TeamRoute>} />
          <Route path="/ops/packers" element={<TeamRoute team="packers"><OpsPackers /></TeamRoute>} />
          <Route path="/ops/valuation" element={<TeamRoute team="valuation"><OpsValuation /></TeamRoute>} />
          <Route path="/ops/referrals" element={<OpsReferrals />} />
          <Route path="/ops/share-review" element={<OpsShareReview />} />
        </Route>

        <Route element={<ConsumerLayout />}>
          <Route path="*" element={<Stub title="Page not found" phase="Phase 3" />} />
        </Route>
      </Routes>
      </Suspense>
    </>
  );
}
