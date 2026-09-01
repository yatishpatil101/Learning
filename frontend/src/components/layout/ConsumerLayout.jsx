import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import Navbar from './Navbar.jsx';
import BottomNav from './BottomNav.jsx';
import Footer from './Footer.jsx';
import CityChrome from '../CityChrome.jsx';
import ConnectivityBanner from '../ConnectivityBanner.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import CookieConsent from '../CookieConsent.jsx';
import InstallPrompt from '../InstallPrompt.jsx';
import AssistantWidget from '../assistant/AssistantWidget.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { AppFlagsProvider, useAppFlags } from '../../context/AppFlagsContext.jsx';
import { PricingProvider } from '../../context/PricingContext.jsx';
import { chromeFor } from '../../lib/chrome.js';

/* Maintenance mode overlay — mirrors HTML auth.js lines 607-628.
   When flags.maintenanceMode is true in admin settings, consumer pages are blocked.
   Admin/staff users and internal routes (admin, ops, staff-login) are exempt. */
function MaintenanceOverlay() {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center text-center p-6" style={{ background: '#0f0d1a', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 440 }}>
        <div className="text-5xl mb-2">🛠️</div>
        <h1 className="text-2xl font-extrabold mb-2.5 gradient-text">{t('chrome.maintenanceTitle')}</h1>
        <p className="text-gray-400 leading-relaxed mb-5">{t('chrome.maintenanceBody')}</p>
        <Link to="/staff-login" className="text-teal-300 text-sm font-semibold hover:text-teal-200">{t('chrome.staffSignIn')}</Link>
      </div>
    </div>
  );
}

function ConsumerLayoutContent() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { flags } = useAppFlags();

  // Maintenance mode: block consumer pages, exempt internal users.
  //
  // The banner rides along rather than being left behind the early return (D164). Maintenance mode
  // and a dead uplink look identical from the sofa — a static "we'll be back shortly" page that
  // cannot also say "and by the way, your connection is down" sends the user to support for
  // something a bar of signal fixes. It renders above the overlay's z-[99999] because the overlay
  // is deliberately on top of everything else.
  const isInternal = user && (user.role === 'admin' || user.role === 'staff');
  if (flags.maintenanceMode === true && !isInternal) {
    return (
      <>
        <ConnectivityBanner zClass="z-[100000]" />
        <MaintenanceOverlay />
      </>
    );
  }

  /* Every chrome decision for this route, resolved in one place — see lib/chrome.js.
     `.has-bottom-nav` is what makes --dz-bottom-inset reserve the bar's height, so the
     class and the bar are always mounted together and no widget can be left positioned
     against an inset that isn't there. */
  const { selfPadded, fullBleed, chatRoute, authRoute, showBottomNav, showFooter, showAssistant } = chromeFor(pathname);

  return (
    /* A price is only shown on a surface a flag has already allowed. Both contexts fetch one
       public document for the consumer shell and neither blocks first paint. */
    <PricingProvider>
        <div className={'consumer-layout flex min-h-[100dvh] flex-col' + (chatRoute ? ' route-messages' : '') + (authRoute ? ' route-auth' : '') + (fullBleed ? ' route-fullbleed' : '') + (showBottomNav ? ' has-bottom-nav' : '')}>
          <Navbar />
          {/* Connectivity state, announced once for the whole app rather than guessed at per page.
              Docks under the navbar precisely so it can never cover the bottom nav or its raised
              centre FAB — see ConnectivityBanner for why the bottom was the wrong edge (D128). */}
          <ConnectivityBanner />
          <main id="main-content" className={'consumer-main ' + (selfPadded ? 'flex-1' : 'flex-1 pt-[var(--dz-nav-h)]')}>
            {/* Around the outlet, not around the layout: a page that throws during render takes the
                page down and leaves the navbar, the bottom nav and the connectivity banner standing,
                so the reader can simply go somewhere else. Keyed on the pathname, so doing exactly
                that clears the fallback — otherwise the boundary would outlive the broken route and
                become the outage itself. */}
            <ErrorBoundary scope="consumer-route" resetKey={pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
          {showFooter && <Footer />}
          {/* Nestor help assistant — floating concierge, all consumer pages except full-bleed (reels) */}
          {showAssistant && <div className="dz-assistant-slot">{<AssistantWidget />}</div>}
          <CityChrome />
          <CookieConsent />
          {/* Home-screen install nudge (mobile only, self-silencing). Not on auth
              routes — interrupting a sign-in or OTP entry to sell an app install
              is how you lose the sign-in. */}
          {!authRoute && <InstallPrompt />}
          {showBottomNav && <BottomNav />}
        </div>
    </PricingProvider>
  );
}

export default function ConsumerLayout() {
  return (
    <AppFlagsProvider>
      <ConsumerLayoutContent />
    </AppFlagsProvider>
  );
}
