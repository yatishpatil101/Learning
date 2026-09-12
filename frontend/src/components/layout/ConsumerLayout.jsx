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
import { PostChooserProvider } from '../../context/PostChooserContext.jsx';
import { chromeFor } from '../../lib/chrome.js';

/* Full-screen block for consumer pages while maintenance mode is on. */
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

  // The banner rides along rather than being left behind the early return: maintenance and a dead
  // uplink look identical, and it sits above the overlay because the overlay tops everything else.
  const isInternal = user && (user.role === 'admin' || user.role === 'staff');
  if (flags.maintenanceMode === true && !isInternal) {
    return (
      <>
        <ConnectivityBanner zClass="z-[100000]" />
        <MaintenanceOverlay />
      </>
    );
  }

  /* Every chrome decision for this route in one place (lib/chrome.js). `.has-bottom-nav` is what
     makes --dz-bottom-inset reserve the bar's height, so class and bar always mount together. */
  const { selfPadded, fullBleed, chatRoute, authRoute, showBottomNav, showFooter, showAssistant } = chromeFor(pathname);

  return (
    /* A price is only shown on a surface a flag has already allowed. Both contexts fetch one
       public document for the consumer shell and neither blocks first paint. */
    <PricingProvider>
      {/* Inside the shell, not around it: the sheet navigates on every branch, so it must sit
          under the router and be the SAME instance for every posting control. */}
      <PostChooserProvider>
        <div className={'consumer-layout flex min-h-[100dvh] flex-col' + (chatRoute ? ' route-messages' : '') + (authRoute ? ' route-auth' : '') + (fullBleed ? ' route-fullbleed' : '') + (showBottomNav ? ' has-bottom-nav' : '')}>
          <Navbar />
          {/* Docks under the navbar precisely so it can never cover the bottom nav or its raised
              centre FAB — see ConnectivityBanner for why the bottom is the wrong edge. */}
          <ConnectivityBanner />
          <main id="main-content" className={'consumer-main ' + (selfPadded ? 'flex-1' : 'flex-1 pt-[var(--dz-nav-h)]')}>
            {/* Around the outlet, not the layout, so a throwing page leaves the chrome standing.
                Keyed on pathname, or the boundary outlives the broken route and becomes the outage. */}
            <ErrorBoundary scope="consumer-route" resetKey={pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
          {showFooter && <Footer />}
          {/* Draaz help assistant — floating concierge, all consumer pages except full-bleed (reels) */}
          {showAssistant && <div className="dz-assistant-slot">{<AssistantWidget />}</div>}
          <CityChrome />
          <CookieConsent />
          {/* Not on auth routes — interrupting a sign-in or OTP entry to sell an app install
              is how you lose the sign-in. */}
          {!authRoute && <InstallPrompt />}
          {showBottomNav && <BottomNav />}
        </div>
      </PostChooserProvider>
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
