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

/* Specs live in an audience → feature-area tree (see README "Layout"), and the
 * folder is what routes a spec to a viewport project: `tests/mobile/**` is
 * mobile-only, everything else is desktop-only. This used to be a filename
 * convention (`mobile-*.spec.js`); the folder says the same thing without
 * anyone having to know the rule.
 *
 * MOBILE is deliberately a path fragment rather than a testDir override, because
 * the desktop project needs the inverse of the same expression. */
const MOBILE = /[\\/]tests[\\/]mobile[\\/]/;

/* Specs that must run on BOTH a desktop and a mobile viewport.
 *
 * These came from the old frontend/ suite, whose config ran every spec on both
 * viewports — listing them here is what stops the move from silently halving
 * their coverage. It is not academic: the property-detail breadcrumb is
 * `hidden sm:flex`, and only the mobile run catches an assertion that depends
 * on it.
 *
 * Paths are relative to testDir. Add a spec here only when it asserts something
 * genuinely viewport-dependent — it doubles that spec's runtime. */
const CROSS_VIEWPORT = [
  'consumer/flatmates/discovery.spec.js',
  'consumer/flatmates/owner-split.spec.js',
  'consumer/flatmates/posting.spec.js',
  'consumer/property/detail.spec.js',
  'consumer/services/referral-rewards.spec.js',
  'platform/help/centre.spec.js',
  'platform/help/i18n-urls.spec.js',
  'platform/i18n.spec.js',
].map((p) => `**/${p}`);

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
      /* Desktop project runs everything except tests/mobile/**, and never the `live-*` specs —
         those require a running backend and a seeded database, which this suite must not depend
         on (it has to pass with the backend switched off). Run them via
         `playwright.live.config.js`. */
      testIgnore: [MOBILE, /live-.*\.spec\.js/],
    },
    {
      /* Mobile viewport project — tests/mobile/** plus the cross-viewport set.
         Run all projects by default, or target one with `--project=mobile`. */
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: [MOBILE, ...CROSS_VIEWPORT],
    },
    {
      /* Low-end Android baseline (360x640) — the realistic median device in India,
         and the width where bottom chrome, tap targets and labels break first.
         Deliberately tests/mobile/** only: this project exists to stress the chrome
         at a cramped width, not to re-run the whole feature suite a third time. */
      name: 'mobile-small',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 360, height: 640 },
        hasTouch: true,
        isMobile: true,
      },
      testMatch: MOBILE,
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
