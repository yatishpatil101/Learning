import { defineConfig, devices } from '@playwright/test';

/**
 * PuneNest E2E configuration.
 *
 * Single source of truth for where the app lives. Every spec derives its base
 * URL from here (via the `baseURL` use-option and the shared `BASE_URL` env),
 * so there are no hardcoded ports scattered across specs.
 *
 * The React app is the Vite dev server in ../frontend (port 5173). By default
 * Playwright starts it for you (`webServer`); set BASE_URL to point at an
 * already-running instance (local or deployed) and reuse it instead.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  forbidOnly: CI,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  retries: CI ? 2 : 1,
  workers: CI ? 4 : undefined,
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
      /* Desktop project runs everything except the mobile-specific specs, and never the `live-*`
         specs — those require a running backend and a seeded database, which this suite must not
         depend on (it has to pass with the backend switched off). Run them via
         `playwright.live.config.js`. */
      testIgnore: [/mobile-.*\.spec\.js/, /live-.*\.spec\.js/],
    },
    {
      /* Mobile viewport project — only the mobile-* specs. Run all projects by
         default, or target one with `--project=mobile`. */
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile-.*\.spec\.js/,
    },
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
