import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { APIProvider } from '@vis.gl/react-google-maps';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { CityProvider } from './context/CityContext.jsx';
import { CompareProvider } from './context/CompareContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { GOOGLE_MAPS_API_KEY } from './lib/mapsConfig.js';
import { initPmf } from './lib/pmf.js';
import './i18n';
import './styles/index.css';

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
          <CompareProvider>
            <ToastProvider>
              {withMaps(<App />)}
            </ToastProvider>
          </CompareProvider>
        </CityProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
