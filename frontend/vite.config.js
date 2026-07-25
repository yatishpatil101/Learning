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

export default defineConfig({
  plugins: [react(), persistPlugin()],
  build: {
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
