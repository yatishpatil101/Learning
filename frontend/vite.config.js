import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import helpContentPlugin from './scripts/vite-plugin-help-content.mjs';
import blogPlugin from './scripts/vite-plugin-blog.mjs';
import localityGuidesPlugin from './scripts/vite-plugin-locality-guides.mjs';

const PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:8080';

/* Vite's HTML %ENV% replacement has no fallback and leaves an unset name as literal text, but the deploy build
   leaves VITE_API_BASE unset and relies on config.js's '/api' default — so the preload applies the same default. */
function apiBaseHtmlPlugin() {
  let base = '/api';
  return {
    name: 'draazy-api-base-html',
    configResolved(c) { base = c.env.VITE_API_BASE || '/api'; },
    transformIndexHtml: (html) => html.replaceAll('__API_BASE__', base),
  };
}
/* Cache shell/static assets only; listing/account data must stay NetworkOnly so stale availability
   or private state never ships from a service worker. */
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
      // Precache only the initial load graph: dist is ~7 MB. Home is bundled into index-*, so an
      // installed app launched offline still has its landing page.
      globPatterns: [
        // NOT woff2: self-hosting put 22 subset files (~857 KB) in dist, including Devanagari
        // subsets an English visitor never renders. The runtime rule below caches them on use.
        '**/*.{css,html}',
        'assets/index-*.js',
        'assets/vendor-react-*.js',
      ],
      globIgnores: ['**/floorplans/**', 'blog.html', 'blog/**', 'locality.html', 'locality/**'],
      importScripts: ['push-sw.js'],
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
          // Card copies only: originals are CORS-fetched for the canvas hash, which caching would break.
          urlPattern: ({ url }) => url.origin === 'https://images.unsplash.com'
            || /\/photos\/[0-9a-f-]{36}\/[0-9a-f-]{36}(?:-[0-9a-f]{16})?\.w\d+\.jpg$/.test(url.pathname),
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
  plugins: [react(), helpContentPlugin({ root: __dirname }), blogPlugin({ root: __dirname }), localityGuidesPlugin({ root: __dirname }), pwaPlugin(), apiBaseHtmlPlugin()],
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
