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

/* Specs that must run on BOTH a desktop and a mobile viewport.
 *
 * The suite convention is prefix-based: `mobile-*.spec.js` is mobile-only, and
 * everything else is desktop-only. These specs came from the old frontend/ suite,
 * whose config ran every spec on both viewports — so listing them here is what
 * stops the move from silently halving their coverage. It is not academic: the
 * property-detail breadcrumb is `hidden sm:flex`, and only the mobile run catches
 * an assertion that depends on it.
 *
 * Add a spec here only when it asserts something genuinely viewport-dependent. */
const CROSS_VIEWPORT = [
  'flatmates-discovery.spec.js',
  'flatmates-owner-split.spec.js',
  'flatmates-posting.spec.js',
  'help-centre.spec.js',
  'help-i18n-urls.spec.js',
  'i18n.spec.js',
  'property-detail.spec.js',
  'referral-rewards.spec.js',
];

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
      /* Desktop project runs everything except the mobile-specific specs. */
      testIgnore: /mobile-.*\.spec\.js/,
    },
    {
      /* Mobile viewport project — the mobile-* specs plus the cross-viewport set.
         Run all projects by default, or target one with `--project=mobile`. */
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: [/mobile-.*\.spec\.js/, ...CROSS_VIEWPORT],
    },
    {
      /* Low-end Android baseline (360x640) — the realistic median device in India,
         and the width where bottom chrome, tap targets and labels break first.
         Deliberately mobile-* only: this project exists to stress the chrome at a
         cramped width, not to re-run the whole feature suite a third time. */
      name: 'mobile-small',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 360, height: 640 },
        hasTouch: true,
        isMobile: true,
      },
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
