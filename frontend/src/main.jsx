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
import { ensureMockDb } from './lib/mockApi.js';
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

/* D129 — the one await between the module graph and the first render.
   `db.json` is now a lazy chunk (see lib/mockApi/core.js), so the mock store may not
   exist yet on a first visit. Every mockApi reader stays synchronous — including
   `AppFlagsContext`, which reads flags in a `useState` initialiser during render —
   and they stay correct because this resolves first. Nothing in the app reads the
   store at module scope, so the gate is exhaustive; a read that beat it anyway would
   throw out of `rawLoad()` rather than quietly return an empty database.

   It resolves without a fetch on every visit after the first, so this is not a
   render-blocking round trip for a returning user.

   A failure here is logged and rendered through: a first-time visitor gets a loud
   console error naming the cause instead of a blank page with no explanation, and the
   seed promise is not cached on rejection, so the next read retries the fetch. */
ensureMockDb()
  .catch((err) => { console.error('[boot] mock store failed to initialise', err); })
  .finally(() => {
    /* The app's readiness contract, for anything outside the page that needs to know the
       store exists — end-to-end specs, most of all.

       "The network went quiet" is not that signal and never was. Vite fetches the module
       graph and only then evaluates it, so the last response lands roughly a second before
       `main.jsx` runs: Playwright's `networkidle` resolves while the document is still
       empty. That used to be survivable by accident — the store was written synchronously
       during evaluation, so a command queued at idle could not execute until after the
       write. Moving the seed behind an `import()` (D129) put the write one hop the other
       side of that boundary, and the accident stopped holding: specs reading the store
       straight after `goto` began seeing `null`. The ones spelling it `|| '{}'` then wrote
       that empty object back over the real store.

       Set before `render` rather than after: the store is what callers are waiting on, and
       it is ready now. */
    document.documentElement.dataset.pnBoot = 'ready';

    /* Fetch the operator's map policy and city roster — where each city centres and how far it
       extends, which cities are live, whether locality search is fenced to those bounds, which
       places to hide from every suggestion box.

       Inside the gate, not at module scope, because in mock mode this reads the store that
       `ensureMockDb` seeds; fired before it resolves, it would find nothing and silently fall back
       to the built-ins. Not awaited, because the readers in `lib/geoConfig.js` are synchronous and
       answer from those built-ins until this lands — blocking the first paint on a config fetch
       would buy nothing a visitor could perceive, `CityContext` subscribes via `onGeoChange` so the
       roster re-renders the moment it arrives, and the one reader that must not answer early (the
       blacklist) waits on `geoPolicySettled()` inside `lib/places.js`. Fired here rather than from
       a provider because half the consumers are not components — the Places wrapper, the
       List-Property geocoder.

       And again on every admin save, so an operator who takes a city live sees it in the tab they
       did it in rather than after a reload. The listener is registered here, beside the first
       fetch, for the same store-ordering reason. Cross-tab is out of scope by design: this document
       changes a handful of times a year, and other tabs pick it up on their next load. */
    loadGeoPolicy();
    window.addEventListener('punenest-settings-change', loadGeoPolicy);

    createRoot(document.getElementById('root')).render(app);
  });
