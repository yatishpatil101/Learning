import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { APIProvider } from '@vis.gl/react-google-maps';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { CityProvider } from './context/CityContext.jsx';
import { CompareProvider } from './context/CompareContext.jsx';
import { SavedProvider } from './context/SavedContext.jsx';
import { FollowProvider } from './context/FollowContext.jsx';
import { SavedSearchProvider } from './context/SavedSearchContext.jsx';
import { PlanProvider } from './context/PlanContext.jsx';
import { VerificationProvider } from './context/VerificationContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import { ConversationProvider } from './context/ConversationContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { GOOGLE_MAPS_API_KEY } from './lib/mapsConfig.js';
import { initPmf } from './lib/pmf.js';
import { initProductAnalytics } from './lib/productAnalytics.js';
import { loadGeoPolicy } from './lib/geoConfig.js';
import './i18n';
// Ahead of index.css so @font-face lands before anything sets font-family. A JS import because
// postcss.config.js loads only tailwind + autoprefixer, so the JS graph is the reliable bundler.
import './styles/fonts.css';
import './styles/index.css';
// Tier 0 — used app-wide, so they load globally right after index.css rather than
// being trapped inside whichever route chunk happened to import them.
import './styles/components/buttons.css';
import './styles/components/surfaces.css';
// Global, not imported by DateField/TimeField: those are lazy, so a component-level import would
// leave `.dz-cal` unstyled anywhere picker markup renders without pulling the component in.
import './styles/components/date-time-fields.css';
// The shared <Select>/<MultiSelect>/<Menu> dropdown skin (.dz-dropdown), used on every route.
import './styles/components/dropdown.css';

// Boot the temporary PMF-test overlay (GA4). No-op unless VITE_PMF_MODE=on.
initPmf();
initProductAnalytics();

// Bootstrap the Maps JS API once app-wide so every locality box can use Places, not just map
// pages. Without a key the provider is skipped and consumers fall back to the static registry.
const withMaps = (node) =>
  GOOGLE_MAPS_API_KEY ? <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>{node}</APIProvider> : node;

// "auto" restoration lands this SPA part-scrolled once async content and reveals run. Scoped to
// reloads so back/forward still restores, and set before React renders to beat the deferred restore.
if ('scrollRestoration' in history) {
  const navEntry = performance.getEntriesByType?.('navigation')?.[0];
  if (navEntry?.type === 'reload') history.scrollRestoration = 'manual';
}

const app = (
  <StrictMode>
    {/* The boundary that matters day to day is the one inside each layout, around the route outlet. */}
    <ErrorBoundary scope="app">
    <BrowserRouter>
      <AuthProvider>
        <CityProvider>
          {/* Inside AuthProvider: the shortlist is caller-scoped, so it loads on sign-in and
              clears on sign-out by watching that context. */}
          <SavedProvider>
            <SavedSearchProvider>
              {/* One follow-state request here prevents per-card requests. */}
              <FollowProvider>
              {/* Plan is read during render by paywall and pricing surfaces. */}
              <PlanProvider>
              {/* One verification request feeds badges across profile, dashboard and contact flows. */}
              <VerificationProvider>
              {/* Same reasoning: the inbox is caller-scoped, so the unread count loads on sign-in
                  and zeroes on sign-out rather than reading an anonymous store. */}
              <NotificationProvider>
                <ConversationProvider>
                  <CompareProvider>
                    <ToastProvider>
                      {withMaps(<App />)}
                    </ToastProvider>
                  </CompareProvider>
                </ConversationProvider>
              </NotificationProvider>
              </VerificationProvider>
              </PlanProvider>
              </FollowProvider>
            </SavedSearchProvider>
          </SavedProvider>
        </CityProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);

/* The ready marker means the application has rendered. `loadGeoPolicy` stays asynchronous: its
  synchronous readers use built-ins until it arrives, so first paint does not wait on configuration. */
document.documentElement.dataset.dzBoot = 'ready';
loadGeoPolicy();
window.addEventListener('draazy-settings-change', loadGeoPolicy);
createRoot(document.getElementById('root')).render(app);
