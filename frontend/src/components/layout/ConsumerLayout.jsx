import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import Navbar from './Navbar.jsx';
import BottomNav from './BottomNav.jsx';
import Footer from './Footer.jsx';
import CityChrome from '../CityChrome.jsx';
import CookieConsent from '../CookieConsent.jsx';
import AssistantWidget from '../assistant/AssistantWidget.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { AppFlagsProvider } from '../../context/AppFlagsContext.jsx';
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

function isMaintenanceMode() {
  try {
    // Check React admin DB first, then HTML legacy key
    let db = JSON.parse(localStorage.getItem('puneNestDB_v1'));
    if (db?.settings?.flags?.maintenanceMode) return true;
    db = JSON.parse(localStorage.getItem('puneNestAdminDB_v5'));
    if (db?.settings?.flags?.maintenanceMode) return true;
  } catch { /* ignore */ }
  return false;
}

export default function ConsumerLayout() {
  const { pathname } = useLocation();
  const { user } = useAuth();

  // Maintenance mode: block consumer pages, exempt internal users
  const isInternal = user && (user.role === 'admin' || user.role === 'staff');
  if (isMaintenanceMode() && !isInternal) {
    return <MaintenanceOverlay />;
  }

  /* Every chrome decision for this route, resolved in one place — see lib/chrome.js.
     `.has-bottom-nav` is what makes --pn-bottom-inset reserve the bar's height, so the
     class and the bar are always mounted together and no widget can be left positioned
     against an inset that isn't there. */
  const { selfPadded, chatRoute, authRoute, showBottomNav, showFooter, showAssistant } = chromeFor(pathname);

  return (
    <AppFlagsProvider>
      <div className={'flex min-h-[100dvh] flex-col' + (chatRoute ? ' route-messages' : '') + (authRoute ? ' route-auth' : '') + (showBottomNav ? ' has-bottom-nav' : '')}>
        <Navbar />
        <main id="main-content" className={'consumer-main ' + (selfPadded ? 'flex-1' : 'flex-1 pt-[var(--pn-nav-h)]')}>
          <Outlet />
        </main>
        {showFooter && <Footer />}
        {/* Nestor help assistant — floating concierge, all consumer pages except full-bleed (reels) */}
        {showAssistant && <div className="pn-assistant-slot">{<AssistantWidget />}</div>}
        <CityChrome />
        <CookieConsent />
        {showBottomNav && <BottomNav />}
      </div>
    </AppFlagsProvider>
  );
}
