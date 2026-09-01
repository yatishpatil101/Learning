import { defineConfig, devices } from '@playwright/test';

/**
 * The no-backend residue: the handful of specs that must run with **no server at all**.
 *
 * This file used to be `playwright.config.js` — the default, and for most of the project's life the
 * whole suite, because the app was mock-backed and nothing needed a server. That is over. The mock
 * is deleted, every behavioural spec now asserts against the real API, and `playwright.config.js`
 * is the live config. What is left here is not "the tests that have not been converted yet"; it is
 * three files that would be *made worse* by a backend:
 *
 *   - `consumer/connectivity` fault-injects HTTP failures and offline transitions. Its subject is
 *     how the app presents an unreachable API, so a reachable one removes the thing under test.
 *   - `contact-identity-masking` and `consumer/services/rent-agreement` assert client-side rules
 *     about identity and draft persistence that never cross the wire.
 *
 * Run with `npm run test:nobackend`. It is fast, needs no Postgres, and — unlike the live config —
 * destroys nothing, so it is the safe thing to run while another lane is mid-flight.
 *
 * Single source of truth for where the app lives. Every spec derives its base URL from here (via
 * the `baseURL` use-option and the shared `BASE_URL` env), so there are no hardcoded ports
 * scattered across specs.
 *
 * The React app is the Vite dev server in ../frontend (port 5173). By default Playwright starts it
 * for you (`webServer`); set BASE_URL to point at an already-running instance (local or deployed)
 * and reuse it instead.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const CI = !!process.env.CI;

/* The `CROSS_VIEWPORT` list and the `mobile` project it fed are gone.
 *
 * That list existed to opt a desktop spec into a second, phone-width run, and it carried a standing
 * rule: when a spec on it converts to the live suite, *move* its entry rather than delete it,
 * because "a stale path here matches nothing and reports nothing, so the loss is silent". The rule
 * was followed — every entry was moved to the live config's `mobile` project — and the list emptied
 * itself. `[].map(...)` is `[]`, and `testMatch: []` matches nothing, so the `mobile` project was
 * running zero specs and reporting a clean result for them: exactly the silent loss the rule was
 * written to prevent, arrived at by obeying it.
 *
 * There is nothing here to restore. The three specs this config still owns are client-side by
 * nature and none of them asserts anything viewport-dependent. Cross-viewport coverage is the live
 * config's job now, where the specs and the `mobile` / `mobile-small` projects both live. */

export default defineConfig({
  testDir: './tests',
  forbidOnly: CI,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  retries: CI ? 2 : 1,
  /* Four workers everywhere, not "half the cores" locally.
   *
   * Playwright's default is `cores / 2`, which on a 22-core dev box is eleven browsers against a
   * single Vite dev server. That is not a faster suite, it is a contended one: the failures it
   * produces are timeouts and strict-mode violations that depend on how long a page took to
   * hydrate, so they move around between runs and read exactly like product bugs. Matching CI's 4
   * means a local failure means the same thing a CI failure does, which is the only way the suite
   * is worth running locally at all. */
  workers: 4,
  fullyParallel: true,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      /* One project, one viewport. `live-*` is excluded because those specs need a running backend
         and a seeded database, which is the whole distinction this config exists to hold: it must
         pass with the server switched off. Run those via the default `playwright.config.js`. */
      testIgnore: [/live-.*\.spec\.js/],
    },
    /* The `mobile` (Pixel 7) and `mobile-small` (360x640) projects both used to live here. Both
       now live in `playwright.config.js`, with the specs they exist to stress. */
  ],
  /* Auto-start the frontend dev server unless BASE_URL points elsewhere. */
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm --prefix ../frontend run dev',
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !CI,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
