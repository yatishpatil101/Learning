import { defineConfig, devices } from '@playwright/test';

/**
 * PuneNest E2E configuration — the default suite, against a real backend.
 *
 * This was `playwright.live.config.js` until the mock was deleted. While the app had two data
 * providers there were two suites, and the *default* was the mock one: it had to pass with no
 * backend running, because that is how the UI was developed and demoed. There is one provider now,
 * so a suite that avoids the server is not a safer default, it is a suite that cannot assert
 * anything about the product. The two files swapped names. What survives of the old default is
 * `playwright.nobackend.config.js`, three specs whose subject genuinely is the absence of a server.
 *
 * **This config resets a database.** `globalSetup` drops and reseeds `E2E_DB_NAME`, defaulting to
 * the shared `punenest_e2e` lane, so a bare run here will wipe whatever a concurrent session was
 * using. That was survivable while this was the opt-in config nobody invoked by accident; as the
 * default it is a live footgun. Prefer the lane scripts — `run-live-flatmates.ps1`,
 * `run-live-admin.ps1`, `run-live-services.ps1` — which pin the port, the database and the app URL
 * together. Set `E2E_DB_NAME` yourself if you are running specs directly alongside another lane.
 *
 * Prerequisites:
 *   1. Postgres up, with the `punenest_e2e` database created once:
 *        psql -U postgres -c "create database punenest_e2e"
 *      This suite owns that database and resets it to the seeded baseline at the start of every
 *      run (globalSetup below). It is deliberately **not** `punenest` - a run would otherwise wipe
 *      whatever a developer had been doing by hand - and deliberately **not** `punenest_test`,
 *      which the Java suite requires to stay empty. See docs/migration/03-e2e-database-and-users.md.
 *   2. `PUNENEST_DEV_MACHINE` set in the environment the **backend** is launched from. Since
 *      2026-08-09 the `dev` profile alone does not enable the dev stubs: `DevProfileGuard` also
 *      requires this variable, as positive proof that the JVM is on a developer's machine rather
 *      than a container that inherited `dev` from a copied environment file. It is in no committed
 *      file on purpose, so set it once per machine and never in the repo:
 *
 *        [Environment]::SetEnvironmentVariable('PUNENEST_DEV_MACHINE', '1', 'User')
 *
 *      Without it the backend refuses to start, and this suite fails at step 3 below with a login
 *      timeout rather than anything that names the cause - so check the backend console first.
 *   3. Backend on :8081 under **both** profiles:
 *        cd backend; ./mvnw spring-boot:run "-Dspring-boot.run.profiles=dev,e2e" "-Dspring-boot.run.arguments=--server.port=8081"
 *      Order matters and so does having both. `dev` binds the mock OTP sender (without it the
 *      backend boots the SMS sender, which throws, and no login can succeed); `e2e` points the
 *      datasource at `punenest_e2e` and fixes the OTP to a constant. Listing `e2e` last is what
 *      makes its datasource win.
 *
 * Logins no longer scrape the backend log: under the `e2e` profile the OTP is fixed, so
 * `helpers/liveAuth.js` types a constant. `BACKEND_LOG` is therefore no longer read by anything
 * here. Only the digits are predictable - the code is still stored, single-use and expiring, and a
 * wrong one is still refused (see OtpService).
 *
 * `reuseExistingServer: false` is deliberate. It was written when a leftover dev server might have
 * been serving a bundle built with the provider switch *off*, which would have made every assertion
 * here quietly verify the mocks. That particular build no longer exists, but the rule earns its
 * keep unchanged: a reused server is one whose env and working tree nobody in this process checked.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_PORT = process.env.API_PORT || '8081';

/* `tests/mobile/**` is phone-only. The path is what routes a spec to
 * a viewport project, so the desktop project needs the inverse of the same expression — which is
 * why this is a path fragment rather than a `testDir` override. */
const MOBILE = /[\\/]tests[\\/]mobile[\\/]/;

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
  // Restores the seeded baseline before the first test. At the *start* rather than in a teardown,
  // so that a crashed or interrupted run leaves its evidence intact and the next run still begins
  // from known rows - see global-setup.live.js.
  globalSetup: './global-setup.live.js',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  // Kept at 1 for now. The reason it *had* to be 1 is gone - the fixed OTP means no two logins race
  // for the newest line in a shared log - but the specs still share seeded fixtures and a single
  // session cache, so raising it is its own change with its own evidence, not a side effect of this
  // one.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      /* The top-level `testMatch` admits every `live-*` spec, including the phone-only ones, so
         the desktop project has to exclude them by hand. Without this the mobile folder would run
         a third time at 1280px, where its assertions mean nothing — a tap target that is 48px on a
         phone is not evidence about a phone if it was measured on a laptop. */
      testIgnore: MOBILE,
    },
    {
      /* Mobile viewport, for the specs that assert something genuinely viewport-dependent.
       *
       * This mirrors `CROSS_VIEWPORT` in `playwright.config.js`, and exists for the same reason:
       * `Footer.jsx` renders each column as an accordion that is **closed** below `sm`, and the
       * property-detail breadcrumb is `hidden sm:flex`, so a desktop-only run passes against
       * markup that is broken on a phone. When a cross-viewport spec is converted to the live
       * suite its entry has to move to this list, or the conversion silently halves its coverage
       * — which is exactly the trap the original list was written to prevent.
       *
       * `tests/mobile/**` needs no entry: the folder itself is the routing rule. */
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: [
        MOBILE,
        '**/consumer/flatmates/live-discovery.spec.js',
        /* Moved from `CROSS_VIEWPORT` with the conversion of `consumer/flatmates/owner-split`.
           It earns the second viewport for the reason its mock twin did: the whole flow runs inside
           `SplitFlatModal`, and a modal at phone width is the control most likely to clip its own
           confirm button. The desktop run would still pass with the button off-screen. */
        '**/consumer/flatmates/live-owner-split.spec.js',
        '**/consumer/flatmates/live-posting.spec.js',
        /* Moved from `CROSS_VIEWPORT` with the conversion of `consumer/services/referral-rewards`.
           It earns the second viewport for the same reason its mock twin did: the contact box is
           rendered twice on the detail page and which copy answers `Request number` is layout, so a
           desktop-only run proves nothing about the press a phone user actually makes — and the
           exhausted upsell is a modal, the control most likely to break at a cramped width. */
        '**/consumer/services/live-referral-rewards.spec.js',
        '**/platform/help/live-centre.spec.js',
        '**/platform/help/live-i18n-urls.spec.js',
        '**/platform/live-i18n.spec.js',
      ],
    },
    {
      /* Low-end Android baseline (360x640) — the realistic median device in India, and the width
         where bottom chrome, tap targets and labels break first. Deliberately `tests/mobile/**`
         only: this project exists to stress the chrome at a cramped width, not to re-run the whole
         feature suite a third time. Carried over from the mock config in wave 3 rather than
         dropped, because the width that breaks first is the width worth testing. */
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
  webServer: {
    command: `npm --prefix ../frontend run dev -- --port ${new URL(BASE_URL).port} --strictPort`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      /* `VITE_API_DOMAINS` stood here as a hand-maintained comma list of 45 domain names, and it is
         gone with the switch it drove. Worth recording what it cost while it existed: a domain that
         shipped complete but was never added to the list served mocks in every "live" run, silently,
         and `permissions` was in exactly that state — 46 http providers against 45 listed names. A
         list that has to agree with a directory will eventually disagree with it, and the run that
         notices is the one that was supposed to be the evidence. */
      VITE_API_BASE: '/api',
      VITE_PROXY_TARGET: `http://localhost:${API_PORT}`,
    },
  },
});
