import { defineConfig, devices } from '@playwright/test';

/**
 * LIVE integration config — the only one that talks to a real backend.
 *
 * Separate from `playwright.config.js` on purpose. The main suite must pass with **no backend
 * running**, because that is how the UI is developed and demoed; making it conditionally depend on
 * infrastructure would make a failure ambiguous ("is the app broken, or is Postgres down?").
 *
 * Prerequisites:
 *   1. Postgres up with the seeded dev DB (`punenest`).
 *   2. Backend on :8081 — `cd backend; ./mvnw spring-boot:run -Dspring-boot.run.arguments=--server.port=8081`
 *      with its console tee'd to a log the spec can read the OTP from (BACKEND_LOG).
 *
 * The dev server is started here with the property domain switched on, so this config is the single
 * place that knows the live wiring:
 *
 *   cd e2e; npx playwright test --config=playwright.live.config.js
 *
 * `reuseExistingServer: false` is deliberate — a dev server left over from a mock-mode run would
 * serve a bundle built with the switch *off*, and every assertion here would then quietly verify
 * the mocks instead of the API.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_PORT = process.env.API_PORT || '8081';

export default defineConfig({
  testDir: './tests',
  testMatch: /live-.*\.spec\.js/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1, // Shared session + a single OTP log; parallel logins would race for the latest code.
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm --prefix ../frontend run dev -- --port ${new URL(BASE_URL).port} --strictPort`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      VITE_API_DOMAINS: 'auth,property,notification,conversation',
      VITE_API_BASE: '/api',
      VITE_PROXY_TARGET: `http://localhost:${API_PORT}`,
    },
  },
});
