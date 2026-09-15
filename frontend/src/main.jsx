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
    {/* The backstop, and only the backstop. The boundary that matters day to day is the one inside
        each layout, around the route outlet — it keeps the navbar and the bottom nav alive so a
        broken page is an inconvenience rather than a dead end. This one exists for the cases that
        boundary cannot see: a provider that throws while initialising, or the chrome itself. There
        is nothing left to preserve at that point, so its fallback offers a reload and a link home
        rather than pretending a re-render will help. No `resetKey`: outside the router there is no
        navigation to reset on. */}
    <ErrorBoundary scope="app">
    <BrowserRouter>
      <AuthProvider>
        <CityProvider>
          {/* Inside AuthProvider: the shortlist is caller-scoped, so it loads on sign-in and
              clears on sign-out by watching that context. */}
          <SavedProvider>
            <SavedSearchProvider>
              {/* Same reasoning again: five surfaces ask which societies the caller follows, and
                  the finder and the directory ask once per rendered row. Held here so that is one
                  request rather than one per card (D227). */}
              <FollowProvider>
              {/* Also caller-scoped, and read during render rather than awaited: the paywall, the
                  Feature action and the pricing card all ask which plan is held while drawing.
                  Holding it here makes that one request instead of one per asker. */}
              <PlanProvider>
              {/* Also caller-scoped and read during render: the opt-in identity badge decides which
                  trust ribbon or nudge to draw across the profile, dashboard and contact flows.
                  Held here so that is one request, not one per asker. */}
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
