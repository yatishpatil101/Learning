import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { APIProvider } from '@vis.gl/react-google-maps';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { CityProvider } from './context/CityContext.jsx';
import { CompareProvider } from './context/CompareContext.jsx';
import { SavedProvider } from './context/SavedContext.jsx';
import { SavedSearchProvider } from './context/SavedSearchContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import { ConversationProvider } from './context/ConversationContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { GOOGLE_MAPS_API_KEY } from './lib/mapsConfig.js';
import { initPmf } from './lib/pmf.js';
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CityProvider>
          {/* Inside AuthProvider: the shortlist is caller-scoped, so it loads on sign-in and
              clears on sign-out by watching that context. */}
          <SavedProvider>
            <SavedSearchProvider>
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
            </SavedSearchProvider>
          </SavedProvider>
        </CityProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
