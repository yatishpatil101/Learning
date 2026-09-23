import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import helpContentPlugin from './scripts/vite-plugin-help-content.mjs';

const PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:8080';

/* Scope is deliberately narrow: cache the *shell and static assets*, never listing or account data
   — a cached listing that still says "available" after it is rented is a product failure. So
   `/api/*` is NetworkOnly, asserted by a test. `manifest: false` because public/manifest.webmanifest
   already exists and index.html already links it. */
function pwaPlugin() {
  return VitePWA({
    // The shell must never be a version behind the deployed API contract, and a page reload has no
    // half-finished work to protect, so update silently rather than prompting.
    registerType: 'autoUpdate',
    injectRegister: 'auto',
    manifest: false,
    // A service worker on the dev server would make Playwright and local edits nondeterministic.
    devOptions: { enabled: false },
    workbox: {
      // Precache only the initial load graph: dist is ~7 MB. The home-* chunks are here so an
      // installed app launched offline does not 404 on the lazy landing chunk and go blank.
      globPatterns: [
        // NOT woff2: self-hosting put 22 subset files (~857 KB) in dist, including Devanagari
        // subsets an English visitor never renders. The runtime rule below caches them on use.
        '**/*.{css,html}',
        'assets/index-*.js',
        'assets/vendor-react-*.js',
        'assets/home-*.js',
      ],
      globIgnores: ['**/floorplans/**'],
      // SPA deep links resolve to the shell. The denylist is the important half: without it, a
      // navigation request to /api/* would be answered with index.html.
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
      runtimeCaching: [
        {
          // First rule wins, so the data exclusion is stated first. Matching on pathname, not a
          // regex over the whole URL — a bare /^\/api\// would never match an absolute URL.
          urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
          handler: 'NetworkOnly',
        },
        {
          // Hashed filenames are content-addressed — a given URL can never point at different
          // bytes — so CacheFirst is safe. The lazy route chunks land here on first visit.
          urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/assets\/.*-[\w-]{8,}\.(js|css|mjs)$/.test(url.pathname),
          handler: 'CacheFirst',
          options: {
            cacheName: 'dz-assets',
            expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
          },
        },
        {
          // Immutable per URL (the filename encodes family, weight and subset index). Runtime, not
          // precached: each visitor caches only the subsets their language renders.
          urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/fonts/'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'dz-fonts',
            expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          // Listing photography: immutable per URL and the heaviest thing on a card. Capped so a
          // long browsing session cannot fill the device's storage quota.
          urlPattern: ({ url }) => url.origin === 'https://images.unsplash.com',
          handler: 'CacheFirst',
          options: {
            cacheName: 'dz-images',
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
        // Peel heavy, self-contained vendor libraries into their own long-lived cacheable chunks.
        manualChunks(id) {
          const n = id.replace(/\\/g, '/');
          // Shared runtime helpers MUST be pinned to the eager vendor chunk. Left unassigned,
          // Rollup folds them into a vendor chunk and drags that whole chunk into the entry.
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
    // `Origin` is rewritten because the browser sends the dev-server origin even on same-origin
    // POSTs, and the backend's CORS filter allows only 5173. (`changeOrigin` only rewrites `Host`.)
    proxy: {
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true,
        headers: { origin: PROXY_TARGET },
        // No rewrite: the backend sets `server.servlet.context-path=/api`, so it genuinely serves
        // `/api/auth/login`. Stripping the prefix 404s the moment VITE_API_BASE names a real host.
      },
    },
    watch: {
      // OneDrive-synced folders on Windows lock files mid-sync, which makes Chokidar's native
      // watcher throw `EBUSY` and crash the dev server. Polling avoids the native lock.
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
