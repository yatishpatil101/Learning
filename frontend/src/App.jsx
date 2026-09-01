import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { lazy, Suspense, useEffect, useRef } from 'react';

import ConsumerLayout from './components/layout/ConsumerLayout.jsx';
import AdminLayout from './components/layout/AdminLayout.jsx';
import PreviewBanner from './components/pmf/PreviewBanner.jsx';
import { ProtectedRoute, RoleRoute, FlagRoute, AppFlagRoute, ModuleRoute } from './components/RouteGuards.jsx';
import { lazyPage } from './i18n/lazyPage.js';
import { applyAppPrefs } from './lib/store.js';
import { track } from './lib/pmf.js';

/* ─── Synchronous imports (critical path — needed immediately) ─── */
import Home from './pages/consumer/Home.jsx';
import Signin from './pages/consumer/Signin.jsx';
import Signup from './pages/consumer/Signup.jsx';
import StaffLogin from './pages/consumer/StaffLogin.jsx';
import Stub from './pages/Stub.jsx';
import HelpLangRoute from './components/help/HelpLangRoute.jsx';

/* Route-shaped Suspense fallbacks. These have to be in the entry chunk by
   definition — a placeholder that arrives with the chunk it is covering for is
   no placeholder at all — so they are plain markup with no imports of their own,
   and must stay that way or they will drag a route's dependencies into the
   critical path. */
import DashboardSkeleton from './pages/consumer/dashboard/DashboardSkeleton.jsx';
import FlatmatesSkeleton from './pages/consumer/flatmates/FlatmatesSkeleton.jsx';
import SocietySkeleton from './pages/consumer/society/SocietySkeleton.jsx';

/* ─── Lazy consumer pages (loaded on navigation) ───

   `lazyPage(loader, ...namespaces)` is `lazy()` plus the route's English locale
   namespaces, fetched in parallel with the chunk and behind the same Suspense
   fallback (D129 — English used to be bundled whole, 253 KB on every visitor's
   critical path). Routes with no namespace listed use only the eager shell set;
   `npm run check:i18n` proves that from the import graph, so a route that starts
   using a new namespace fails the build rather than rendering raw keys. */
const Listings = lazyPage(() => import('./pages/consumer/Listings.jsx'), 'listings', 'owner', 'property', 'verify');
const Property = lazyPage(() => import('./pages/consumer/Property.jsx'), 'listings', 'owner', 'property', 'verify');
const Owner = lazyPage(() => import('./pages/consumer/Owner.jsx'), 'owner');
const Compare = lazyPage(() => import('./pages/consumer/Compare.jsx'), 'compare-saved');
const Dashboard = lazyPage(() => import('./pages/consumer/Dashboard.jsx'), 'dashboard', 'flatmates', 'locality', 'owner', 'owner-hub', 'verify');
const DevSeed = lazy(() => import('./pages/consumer/DevSeed.jsx'));
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
const Checkout = lazyPage(() => import('./pages/consumer/Checkout.jsx'), 'misc2');
const ScheduleVisit = lazy(() => import('./pages/consumer/ScheduleVisit.jsx'));
const Society = lazyPage(() => import('./pages/consumer/Society.jsx'), 'list-property', 'property', 'society');
const Societies = lazyPage(() => import('./pages/consumer/Societies.jsx'), 'society');
const Reels = lazyPage(() => import('./pages/consumer/Reels.jsx'), 'reels-docs');
const Saved = lazyPage(() => import('./pages/consumer/Saved.jsx'), 'compare-saved');
const PayRent = lazyPage(() => import('./pages/consumer/PayRent.jsx'), 'misc2');
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
// AdminFlatmates retired — /admin/flatmates redirects to the live /ops/flatmate-review
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings.jsx'));
const AdminPostOnBehalf = lazy(() => import('./pages/admin/AdminPostOnBehalf.jsx'));
const AdminStaffActivity = lazy(() => import('./pages/admin/AdminStaffActivity.jsx'));
const AdminSocieties = lazy(() => import('./pages/admin/AdminSocieties.jsx'));
const AdminLocalities = lazy(() => import('./pages/admin/AdminLocalities.jsx'));
/* The only admin route with a locale namespace: the approvals queue and the refusals around it are
   new UI (D205) and were written translated. The rest of this page's strings predate D129 and are
   still English \u2014 see the item's report. */
const AdminTeam = lazyPage(() => import('./pages/admin/AdminTeam.jsx'), 'team');

/* ─── Lazy ops pages ─── */
const OpsDashboard = lazy(() => import('./pages/ops/OpsDashboard.jsx'));
const OpsRequests = lazy(() => import('./pages/ops/OpsRequests.jsx'));
const OpsReferrals = lazy(() => import('./pages/ops/OpsReferrals.jsx'));
const OpsFlatmateReview = lazy(() => import('./pages/ops/OpsFlatmateReview.jsx'));
/* Both read the live seam rather than `lib/serviceFlow.js`, and both sit here rather than under
   /admin because their endpoints are staff+admin: the admin group is admin+manager, which would
   lock out the audience the server admits and admit one it refuses (D51, D173). */
const OpsSupportQueue = lazy(() => import('./pages/ops/OpsSupportQueue.jsx'));
const OpsDraftingDesk = lazy(() => import('./pages/ops/OpsDraftingDesk.jsx'));

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
  // PMF funnel: log a page_view on every route change (no-op unless flag on).
  useEffect(() => { track('page_view', { path: pathname }); }, [pathname]);
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
      <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Standalone full-screen secure viewer (own chrome, no consumer nav) */}
        <Route path="/view-documents" element={<ProtectedRoute><ViewDocuments /></ProtectedRoute>} />
        {/* The share-link side of the same viewer (D42). Public by design: the token in the URL
            fragment IS the credential, and the recipient is a lawyer or a banker with no account,
            so a sign-in wall here would make the whole share unusable. The fragment never reaches
            any server — the token travels to the API on an `X-Share-Token` header instead. */}
        <Route path="/shared-documents" element={<ViewDocuments shared />} />
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
          {/* Own boundary so the outer spinner never covers this route: it is centred
              in a 60vh box, and the society page opens on a 224–288px hero, so the
              swap shunts everything below it downward the instant the chunk lands.
              The boundary sits inside the flag guard — a disabled flag redirects, and
              a placeholder for a page nobody is going to see is just a flash. */}
          <Route path="/society" element={<AppFlagRoute flag="societySaaS"><Suspense fallback={<SocietySkeleton />}><Society /></Suspense></AppFlagRoute>} />
          <Route path="/society/:slug" element={<Suspense fallback={<SocietySkeleton />}><Society /></Suspense>} />
          <Route path="/reels" element={<Reels />} />
          {/* Saves live in localStorage and several surfaces (Reels, Compare, the map
              detail panel) already write them while signed out, so a hard auth wall on
              /saved turned the bottom nav's Saved tab into a dead end for exactly those
              users. The page renders the on-device shortlist and prompts for sign-in
              itself — see the signed-out banner in Saved.jsx. */}
          <Route path="/saved" element={<AppFlagRoute flag="savedListings"><Saved /></AppFlagRoute>} />
          <Route path="/pay-rent" element={<ProtectedRoute><PayRent /></ProtectedRoute>} />
          <Route path="/locality" element={<Locality />} />
          <Route path="/locality/:slug" element={<Locality />} />
          <Route path="/map" element={<Navigate to="/listings?view=map" replace />} />
          <Route path="/messages" element={<AppFlagRoute flag="inAppMessaging"><ProtectedRoute><Messages /></ProtectedRoute></AppFlagRoute>} />
          {/* Same reasoning as /society: the hero, the filter deck and the first
              row of cards all arrive together, so a centred spinner guarantees a
              reflow at the exact moment someone reaches for the List/Map toggle. */}
          <Route path="/flatmates" element={<Suspense fallback={<FlatmatesSkeleton />}><Flatmates /></Suspense>} />
          {/* Legacy path kept as a permanent redirect: this was the public URL before
              the feature was renamed to Flatmates, so external links and search results
              still point at it. Only remaining use of the old name in the app. */}
          <Route path="/share-flat" element={<Navigate to="/flatmates" replace />} />
          <Route path="/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
          {/* Help centre — public and indexable. Staff runbooks live under the same
              routes but are filtered out of the tree for non-staff accounts by
              lib/help.js, so a direct link to one 404s for everyone else. */}
          {/* Registered once per language: unprefixed (English, canonical) plus a
              `/hi` and `/mr` prefix. Serving three languages from one URL would
              let a crawler index only one of them, making the Hindi and Marathi
              articles unreachable by search for exactly the people most likely to
              want them. HelpLangRoute binds the prefix to the active language;
              lib/helpUrl.js owns the prefix rule and must stay in step with this
              list. Written out rather than built from a regex param because
              React Router 7 has no pattern syntax for path segments. */}
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
          {/* `/admin/flatmates` was a fourth flatmate desk on the mock: it moderated seekers, groups
              and group applications out of `db.json`, could not see rooms at all, and knew only one
              of the two verdicts a flatmate row carries. `/ops/flatmate-review` does the same three
              jobs against the real API and adds the host-verification queue this page never had, so
              this is a redirect rather than a second screen to keep in step. The guards stay on the
              redirect: an admin without the Flatmates module, or with the flag off, should still be
              refused here rather than bounced onto a desk they may not open. */}
          <Route path="/admin/flatmates" element={<ModuleRoute moduleKey="flatmates"><FlagRoute flag="flatmates"><Navigate to="/ops/flatmate-review" replace /></FlagRoute></ModuleRoute>} />
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
          <Route path="/ops/support" element={<OpsSupportQueue />} />
          <Route path="/ops/drafting-desk" element={<OpsDraftingDesk />} />
          {/* The five team desks were one component (`OpsServiceQueue`) over `localStorage`, so
              once consumers filed through the seam they were reading a store the work no longer
              arrived in. They are gone; `/ops/drafting-desk` is the desk, and `?type=` is what
              used to be five routes. Redirects rather than deletions because operators have these
              bookmarked, and `TeamRoute` is dropped with them: the destination is already behind
              the staff/admin guard and the server scopes the queue to the caller either way. */}
          <Route path="/ops/rent-agreement" element={<Navigate to="/ops/drafting-desk?type=rental" replace />} />
          <Route path="/ops/legal" element={<Navigate to="/ops/drafting-desk?type=legal" replace />} />
          <Route path="/ops/interior" element={<Navigate to="/ops/drafting-desk?type=interior" replace />} />
          <Route path="/ops/packers" element={<Navigate to="/ops/drafting-desk?type=packers" replace />} />
          <Route path="/ops/valuation" element={<Navigate to="/ops/drafting-desk?type=valuation" replace />} />
          <Route path="/ops/referrals" element={<OpsReferrals />} />
          <Route path="/ops/flatmate-review" element={<OpsFlatmateReview />} />
        </Route>

        <Route element={<ConsumerLayout />}>
          <Route path="*" element={<Stub title="Page not found" phase="Phase 3" />} />
        </Route>
      </Routes>
      </Suspense>
    </>
  );
}
