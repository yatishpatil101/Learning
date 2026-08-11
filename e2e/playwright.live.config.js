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
 *   2. `PUNENEST_DEV_MACHINE` set in the environment the **backend** is launched from. Since
 *      2026-08-09 the `dev` profile alone does not enable the dev stubs: `DevProfileGuard` also
 *      requires this variable, as positive proof that the JVM is on a developer's machine rather
 *      than a container that inherited `dev` from a copied environment file. It is in no committed
 *      file on purpose, so set it once per machine and never in the repo:
 *
 *        [Environment]::SetEnvironmentVariable('PUNENEST_DEV_MACHINE', '1', 'User')
 *
 *      Without it the backend refuses to start, and this suite fails at step 3 below with a login
 *      timeout rather than anything that names the cause — so check the backend console first.
 *   3. Backend on :8081 — `cd backend; ./mvnw spring-boot:run -Dspring-boot.run.profiles=dev -Dspring-boot.run.arguments=--server.port=8081`
 *      with its console tee'd to a log the spec can read the OTP from (BACKEND_LOG). The `dev`
 *      profile is what wires the mock OTP sender; without it the backend boots the SMS sender,
 *      which throws, and no OTP ever reaches the log this suite is reading.
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

// A warning rather than a hard failure: the variable is required by the *backend* process, and the
// backend is started by hand (possibly from another terminal), so its absence here is suggestive,
// not conclusive. Worth saying out loud all the same — the symptom of a backend that refused to
// boot is a login timeout thirty seconds into the first spec, which reads like a flaky test.
if (!process.env.PUNENEST_DEV_MACHINE) {
  console.warn(
    '[live] PUNENEST_DEV_MACHINE is not set in this shell. If the backend was started without it, ' +
      'it refused to boot under the `dev` profile and every login below will time out. ' +
      'See docs/LOCAL_DEV.md.',
  );
}

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
      VITE_API_DOMAINS:
        'auth,property,notification,conversation,review,support,report,visit,contact,saved,savedSearch,plan,deal,rent,flatmate,serviceRequest,verification,document,society',
      VITE_API_BASE: '/api',
      VITE_PROXY_TARGET: `http://localhost:${API_PORT}`,
    },
  },
});
