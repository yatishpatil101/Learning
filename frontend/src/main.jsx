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
// Ahead of index.css so the @font-face declarations land before anything sets
// font-family. A JS import rather than a CSS `@import`, per the repo convention:
// postcss.config.js loads only tailwindcss + autoprefixer, so the JS graph is the
// one mechanism guaranteed to bundle this correctly.
import './styles/fonts.css';
import './styles/index.css';
// Tier 0 — shared across routes, so they load globally right after index.css
// rather than from any one route chunk. Both were hoisted out of index.css,
// where they sat under route-named headings ("Property page" / "Owner page")
// despite being used app-wide; extracting those routes would have deleted them
// from every other route.
import './styles/components/buttons.css';
import './styles/components/surfaces.css';
// Global rather than imported by DateField/TimeField. Those are lazy route
// components, so a component-level import only ships `.pn-cal` inside their
// chunk — and the mobile bottom-sheet rules then do not exist for anything that
// renders picker markup without pulling the component in. That regressed
// `mobile/phase3.spec.js`, which measures `.pn-cal` on a route with no date
// field: the element came back position:static with no rule matching at all.
import './styles/components/date-time-fields.css';
// The custom <Select>/<MultiSelect>/<Menu> dropdown skin (.pn-dropdown), used by
// six shared UI components across every route. It sat under the "Listings page"
// heading in index.css purely because that's the prototype it was ported from.
import './styles/components/dropdown.css';

// Boot the temporary PMF-test overlay (GA4). No-op unless VITE_PMF_MODE=on.
initPmf();

// Bootstrap the Google Maps JS API once, app-wide, so every locality/area search
// box (the hero, the Listings filter, and every LocalitySelect) can use Places on
// any page — not just the pages that render a map. The library's loader is a
// module-level singleton, so the inner <APIProvider>s on the map pages (same key)
// simply reuse this one. When no key is configured we skip the provider entirely
// and every consumer fails soft to its static registry (no regression).
const withMaps = (node) =>
  GOOGLE_MAPS_API_KEY ? <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>{node}</APIProvider> : node;

// Prevent the browser from restoring a stale scroll position on refresh. With
// this SPA's async content + reveal animations, "auto" restoration lands the
// page partially scrolled instead of at the top. Scoped to reloads so genuine
// back/forward navigation still restores its scroll position. Set before React
// renders so it beats the browser's deferred restore (no scroll flash).
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
              {/* Also caller-scoped and read during render: the opt-in Aadhaar badge decides which
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

/* The ready marker now means the live-only application has rendered; it is no longer a promise
  that a browser database has been seeded. `loadGeoPolicy` remains asynchronous by design: its
  synchronous readers use built-ins until it arrives, so first paint does not wait on configuration. */
document.documentElement.dataset.pnBoot = 'ready';
loadGeoPolicy();
window.addEventListener('punenest-settings-change', loadGeoPolicy);
createRoot(document.getElementById('root')).render(app);
