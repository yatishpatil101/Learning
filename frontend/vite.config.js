import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Vite plugin: JSON file persistence for mock data.
 * Exposes two dev-only endpoints:
 *   GET  /api/__persist/:key  → reads data/persist/<key>.json
 *   POST /api/__persist/:key  → writes data/persist/<key>.json
 *
 * This lets the mock API layer persist user data to disk (survives
 * browser data clears, shareable across browsers/tabs).
 */
function persistPlugin() {
  const PERSIST_DIR = resolve(__dirname, 'data/persist');

  return {
    name: 'vite-plugin-persist',
    configureServer(server) {
      // Ensure persist directory exists
      if (!existsSync(PERSIST_DIR)) mkdirSync(PERSIST_DIR, { recursive: true });

      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(/^\/api\/__persist\/([a-zA-Z0-9_-]{1,64})$/);
        if (!match) return next();

        const key = match[1];
        const filePath = resolve(PERSIST_DIR, `${key}.json`);

        if (req.method === 'GET') {
          try {
            const data = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : 'null';
            res.setHeader('Content-Type', 'application/json');
            res.end(data);
          } catch {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'read_failed' }));
          }
          return;
        }

        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', () => {
            try {
              // Validate JSON before writing
              JSON.parse(body);
              writeFileSync(filePath, body, 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, size: body.length }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'invalid_json' }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

const PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:8080';

export default defineConfig({
  plugins: [react(), persistPlugin()],build: {
    rollupOptions: {
      output: {
        // Peel heavy, self-contained vendor libraries into their own long-lived
        // cacheable chunks so they aren't bundled into the main entry chunk.
        // Config-only, behavior-preserving: module identity/singletons are
        // unchanged, only the physical chunk boundaries move.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('jspdf')) return 'vendor-jspdf';
          if (id.includes('html2canvas')) return 'vendor-html2canvas';
          if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
          if (id.includes('chart.js') || id.includes('react-chartjs-2')) return 'vendor-charts';
          if (id.includes('dompurify')) return 'vendor-dompurify';
          if (id.includes('react-dom') || id.includes('react-router') || id.includes('/scheduler/')) {
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
        // The backend serves `/auth/login`, not `/api/auth/login` — `/api` exists only as a
        // same-origin marker for the proxy, so strip it before forwarding.
        rewrite: (path) => path.replace(/^\/api/, ''),
        bypass: (req) => (req.url?.startsWith('/api/__persist/') ? req.url : undefined),
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
        '**/data/persist/**',
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
