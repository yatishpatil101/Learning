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
 * the desktop project needs the inverse of the same expression.
 *
 * The folder itself moved to the live suite in wave 3, so today this only keeps a *new*
 * mock-mode mobile spec off the desktop viewport. That is still worth having: the rule is about
 * where a phone spec may run, not about which suite happens to own the folder this month. */
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
 * genuinely viewport-dependent — it doubles that spec's runtime.
 *
 * When a spec on this list is converted to the live suite, move its entry to the
 * `mobile` project in `playwright.live.config.js` rather than deleting it. A stale
 * path here matches nothing and reports nothing, so the loss is silent. */
const CROSS_VIEWPORT = [
  'consumer/flatmates/owner-split.spec.js',
  'consumer/services/referral-rewards.spec.js',
  // `consumer/flatmates/posting` moved to the live suite's `mobile` project with its conversion to
  // `live-posting`. It kept the second viewport rather than following `property/detail` off the
  // list: the whole spec is about *reaching* a Post button, and both how many of those a page
  // renders and which one `.first()` resolves to are layout. It passes at both widths today, so
  // the entry is a guard rather than a current gap — if a width stops rendering an entry point,
  // `.first()` matches nothing and only that width's run says so. That is the opposite of
  // `property/detail`, dropped below because its live twin asserts an `h1` that renders
  // identically everywhere.
  //
  // `platform/help/centre`, `platform/help/i18n-urls` and `platform/i18n` moved to the live
  // suite's `mobile` project (P5b waves 1b and 1e), and `consumer/flatmates/discovery` followed
  // them there. What is left of that file mock-side is one test about a banner the live build
  // cannot render at all (see its header) — a data gap, not a layout one, so it has no claim on a
  // second viewport.
  //
  // `consumer/property/detail` was retired to `live-detail` and deliberately NOT moved, which is
  // the other half of the rule above. It earned its place here for a breadcrumb assertion it had
  // already stopped making: its own comment records that it moved to the `h1` *because* the
  // breadcrumb is `hidden sm:flex` and a locality check only passed on desktop. The live twin
  // asserts that same heading, which renders identically at every width, so a second viewport
  // would double its runtime to re-check a string the layout does not touch.
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
      /* Mobile viewport project — the cross-viewport set only.
         `tests/mobile/**` moved wholesale to the live suite in wave 3, so the folder no longer
         contributes here; what is left is the handful of desktop specs that also have to be proved
         at 412px. Run all projects by default, or target one with `--project=mobile`. */
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: CROSS_VIEWPORT,
    },
    /* The 360x640 `mobile-small` project lived here until wave 3. It ran `tests/mobile/**` and
       nothing else, so when that folder moved to the live suite this project matched zero specs —
       and a project that matches nothing reports nothing, which is the quiet kind of coverage loss
       this file keeps warning about. It now lives in `playwright.live.config.js` with the specs it
       exists to stress. */
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
