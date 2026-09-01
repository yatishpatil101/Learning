import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import helpContentPlugin from './scripts/vite-plugin-help-content.mjs';

const PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:8080';

/**
 * Progressive Web App: installability + an offline-capable app shell.
 *
 * Scope is deliberately narrow (review §H Q6): cache the *shell and static assets*,
 * never listing or account data. On a marketplace, freshness is a trust signal — a
 * cached listing that still says "available" after it has been rented is a product
 * failure, not a performance win. So `/api/*` is NetworkOnly and is asserted to be so
 * by a test, established now while the app is still on mock data and nothing is at
 * stake. When the real backend lands, the correct behaviour is already in place.
 *
 * `manifest: false` because public/manifest.webmanifest already exists and index.html
 * already links it. Letting the plugin generate a second one would create two sources
 * of truth for the app's identity.
 */
function pwaPlugin() {
  return VitePWA({
    // The shell must never be a version behind the deployed API contract, and there is
    // no half-finished work to protect on a page reload, so update silently rather than
    // nagging the user with a "new version" prompt.
    registerType: 'autoUpdate',
    injectRegister: 'auto',
    manifest: false,
    // The dev server is what Playwright drives and what we develop against. A service
    // worker there would make both nondeterministic (stale chunks surviving an edit).
    devOptions: { enabled: false },
    workbox: {
      // dist is ~7 MB across 200 files. Precaching all of it would mean a 7 MB download
      // before the first paint on a 4G connection — the opposite of the goal. Precache
      // only the initial load graph; everything else is cached on first use below.
      //
      // The home-* chunks are here for one specific failure: an installed app launched
      // offline gets index.html from precache, then the lazy landing chunk 404s and the
      // user sees a blank white screen — which reads as "broken app", not "no internet".
      //
      // vendor-charts and vendor-jspdf are deliberately NOT precached. They used to be
      // dragged into the entry chunk (so precaching them was free), but that was a
      // manualChunks bug: unassigned shared modules (`react/jsx-runtime`,
      // `vite/preload-helper`) were folded into those vendor chunks, pulling 571 KB of
      // charting/PDF code in front of first paint. With the chunking fixed they are
      // genuinely lazy, so precaching them would now cost a real 571 KB on install.
      // They fall back to the CacheFirst asset rule below on first actual use.
      globPatterns: [
        // NOT woff2. Self-hosting put 22 subset files (~857 KB) into dist, and a bare
        // `**/*.woff2` would precache every one of them on install — including the
        // Devanagari subsets an English visitor never renders. That is the same bug
        // described above for vendor-charts: install cost paid up front for bytes
        // most users never need. Fonts use `font-display: swap`, so a cold offline
        // load falls back to system type and stays readable; the runtime rule below
        // caches each subset the first time it is actually used.
        '**/*.{css,html}',
        'assets/index-*.js',
        'assets/vendor-react-*.js',
        'assets/home-*.js',
      ],
      globIgnores: ['**/floorplans/**'],
      // SPA deep links resolve to the shell. The denylist is the important half: without
      // it, a navigation request to /api/* would be answered with index.html.
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
      runtimeCaching: [
        {
          // First rule wins, so the data exclusion is stated before any caching rule can
          // claim it. Matching on pathname, not a regex over the whole URL — a bare
          // /^\/api\// would never match "http://host/api/..." and would fail open.
          urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
          handler: 'NetworkOnly',
        },
        {
          // Hashed filenames are content-addressed: a given URL can never point at
          // different bytes, so CacheFirst is safe and a revalidation would be wasted.
          // This is where the lazy route chunks land, on first visit to that route.
          urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/assets\/.*-[\w-]{8,}\.(js|css|mjs)$/.test(url.pathname),
          handler: 'CacheFirst',
          options: {
            cacheName: 'pn-assets',
            expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
          },
        },
        {
          // Self-hosted web fonts. Immutable per URL (the filename encodes family,
          // weight and subset index, and only changes when fetch-fonts.mjs is re-run),
          // so CacheFirst is safe. Deliberately runtime rather than precached: each
          // visitor caches only the subsets their language actually renders.
          urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/fonts/'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'pn-fonts',
            expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          // Listing photography. Images are the heaviest thing on a listing card and
          // they are immutable per URL, so this is the single biggest repeat-visit win.
          // Capped so a long browsing session cannot fill the device's storage quota.
          urlPattern: ({ url }) => url.origin === 'https://images.unsplash.com',
          handler: 'CacheFirst',
          options: {
            cacheName: 'pn-images',
            expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 14 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
  });
}

export default defineConfig({
  plugins: [react(), helpContentPlugin({ root: __dirname }), pwaPlugin()],
  build: {
    rollupOptions: {
      output: {
        // Peel heavy, self-contained vendor libraries into their own long-lived
        // cacheable chunks so they aren't bundled into the main entry chunk.
        // Config-only, behavior-preserving: module identity/singletons are
        // unchanged, only the physical chunk boundaries move.
        manualChunks(id) {
          const n = id.replace(/\\/g, '/');
          // Shared runtime helpers MUST be pinned to the eager vendor chunk.
          // Left unassigned, Rollup folds them into whichever vendor chunk happens
          // to reference them, which then drags that whole chunk into the entry:
          // `vite/preload-helper` landed in vendor-jspdf (382 KB) and
          // `react/jsx-runtime` in vendor-charts (189 KB), so every visitor
          // downloaded 571 KB of PDF/charting code before first paint.
          if (n.includes('vite/preload-helper')) return 'vendor-react';
          if (!n.includes('node_modules')) return;
          if (n.includes('jspdf')) return 'vendor-jspdf';
          if (n.includes('html2canvas')) return 'vendor-html2canvas';
          if (n.includes('pdfjs-dist')) return 'vendor-pdfjs';
          // Keep this before the react rule so react-chartjs-2 stays with charts.
          if (n.includes('chart.js') || n.includes('react-chartjs-2')) return 'vendor-charts';
          if (/node_modules\/react\//.test(n) || n.includes('react-dom')
            || n.includes('react-router') || n.includes('/scheduler/')) {
            return 'vendor-react';
          }
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    open: false,
    // Forward API calls to the local Spring Boot backend. Going through the dev server keeps the
    // browser on one origin, so the browser never preflights and the page's CSP (`connect-src
    // 'self'`) is satisfied without loosening it for a dev-only concern.
    //
    // That is only half the story, and the missing half costs an hour to diagnose: the browser
    // still sends `Origin: http://localhost:<devport>` on POSTs even when they are same-origin, the
    // proxy forwards it verbatim, and the backend's CORS filter judges it. The backend allows
    // `http://localhost:5173` by default, so this works — *by coincidence of port*. Run the dev
    // server on any other port and every POST returns a bare 403 with no CORS wording anywhere,
    // which reads like an auth bug.
    //
    // So rewrite `Origin` to the proxy target. The proxy is the origin server from the backend's
    // point of view, and this makes the "same-origin in dev" promise actually true regardless of
    // which port Vite picks. Dev-only: `server.proxy` does not exist in a production build.
    // (`changeOrigin` only rewrites `Host`, which is why it is not sufficient on its own.)
    proxy: {
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true,
        headers: { origin: PROXY_TARGET },
        // No rewrite: the backend sets `server.servlet.context-path=/api`, so it genuinely serves
        // `/api/auth/login`. This used to strip the prefix, which made `/api` a dev-proxy fiction —
        // it worked here and 404'd the moment VITE_API_BASE named a real host. Forward the path as
        // the client wrote it and dev and prod agree.
      },
    },
    watch: {
      // This project often lives under a OneDrive-synced folder on Windows.
      // OneDrive locks files mid-sync, which makes Chokidar's native
      // ReadDirectoryChangesW watcher throw `EBUSY: resource busy or locked`
      // and crash the dev server → the app URL then returns ERR_CONNECTION_REFUSED
      // and the page appears "broken"/blank. Polling avoids the native lock.
      usePolling: true,
      interval: 300,
      ignored: [
        '**/*.backup',
        '**/*.bak',
        '**/*.orig',
        '**/.rollback/**',
        '**/_rollback/**',
        '**/*.original.jsx',
        '**/e2e/**',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/node_modules/**',
        '**/.git/**',
      ],
    },
  },
});
