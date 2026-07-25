import { Link, Outlet, useLocation } from 'react-router';
import Navbar from './Navbar.jsx';
import Footer from './Footer.jsx';
import CityChrome from '../CityChrome.jsx';
import CookieConsent from '../CookieConsent.jsx';
import AssistantWidget from '../assistant/AssistantWidget.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { AppFlagsProvider } from '../../context/AppFlagsContext.jsx';

/* Maintenance mode overlay — mirrors HTML auth.js lines 607-628.
   When flags.maintenanceMode is true in admin settings, consumer pages are blocked.
   Admin/staff users and internal routes (admin, ops, staff-login) are exempt. */
function MaintenanceOverlay() {
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center text-center p-6" style={{ background: '#0f0d1a', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 440 }}>
        <div className="text-5xl mb-2">🛠️</div>
        <h1 className="text-2xl font-extrabold mb-2.5 gradient-text">We'll be right back</h1>
        <p className="text-gray-400 leading-relaxed mb-5">PuneNest is undergoing scheduled maintenance. Please check back shortly — your saved data is safe.</p>
        <Link to="/staff-login" className="text-teal-300 text-sm font-semibold hover:text-teal-200">Staff & Admin sign in →</Link>
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

  // These pages include their own top offset for the fixed navbar (faithful ports).
  const selfPadded = pathname === '/' || pathname.startsWith('/listings') || pathname.startsWith('/property') || pathname === '/signin' || pathname === '/signup';
  // Full-screen experiences (reels) have no footer/chat in the original.
  const fullBleed = pathname.startsWith('/reels');
  // Messages is an app-native chat: on mobile it goes full-screen and the marketing
  // footer + floating assistant are hidden (CSS, ≤767px) so the composer pins to the
  // viewport bottom. Desktop keeps the footer/assistant unchanged.
  const chatRoute = pathname.startsWith('/messages');
  // Auth screens are a focused conversion funnel: on mobile the long marketing
  // footer + floating assistant under the card are noise (and the assistant bubble
  // can overlap the form's actions), so hide them ≤767px (CSS). Desktop keeps them.
  // /staff-login is the internal-console equivalent of the same funnel.
  const authRoute = pathname === '/signin' || pathname === '/signup' || pathname === '/staff-login';
  return (
    <AppFlagsProvider>
      <div className={'flex min-h-[100dvh] flex-col' + (chatRoute ? ' route-messages' : '') + (authRoute ? ' route-auth' : '')}>
        <Navbar />
        <main id="main-content" className={'consumer-main ' + (selfPadded ? 'flex-1' : 'flex-1 pt-16 md:pt-[72px]')}>
          <Outlet />
        </main>
        {!fullBleed && <Footer />}
        {/* Nestor help assistant — floating concierge, all consumer pages except full-bleed (reels) */}
        {!fullBleed && <div className="pn-assistant-slot">{<AssistantWidget />}</div>}
        <CityChrome />
        <CookieConsent />
      </div>
    </AppFlagsProvider>
  );
}
