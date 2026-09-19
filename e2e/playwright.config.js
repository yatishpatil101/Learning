import { defineConfig, devices } from '@playwright/test';
import { NO_BACKEND } from './no-backend-specs.js';

/* The default suite, against a real backend — prerequisites in `README.md`. **It resets a
   database**: prefer the `run-live-*.ps1` lanes, which pin port, database and app URL together. */
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_PORT = process.env.API_PORT || '8081';

/* `tests/mobile/**` is phone-only. The path is what routes a spec to a viewport project, so the
 * desktop project needs the inverse of the same expression. */
const MOBILE = /[\\/]tests[\\/]mobile[\\/]/;

// The variable is required by the *backend* process, started by hand, so its absence here is
// suggestive rather than conclusive — but a backend that refused to boot reads as a flaky test.
if (!process.env.DRAAZY_DEV_MACHINE) {
  console.warn(
    '[live] DRAAZY_DEV_MACHINE is not set in this shell. If the backend was started without it, ' +
      'it refused to boot under the `dev` profile and every login below will time out. ' +
      'See docs/LOCAL_DEV.md.',
  );
}

export default defineConfig({
  testDir: './tests',
  // At the *start* rather than in a teardown, so a crashed run leaves its evidence intact and the
  // next run still begins from known rows — see global-setup.live.js.
  globalSetup: './global-setup.live.js',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  // The specs share seeded fixtures and a single session cache, so raising this is its own change
  // with its own evidence.
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
      /* Phone-only specs would otherwise run a third time at 1280px, where a 48px tap target is not
         evidence about a phone; `NO_BACKEND` belongs to the other config. */
      testIgnore: [MOBILE, ...NO_BACKEND],
    },
    {
      /* Specs that assert something genuinely viewport-dependent, e.g. a footer that is an accordion below
         `sm`. `tests/mobile/**` needs no entry — the folder itself is the routing rule. */
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: [
        MOBILE,
        '**/consumer/flatmates/live-discovery.spec.js',
        /* The whole flow runs inside `SplitFlatModal`, and a modal at phone width is the control
           most likely to clip its own confirm button — a desktop run passes with it off-screen. */
        '**/consumer/flatmates/owner-split.spec.js',
        '**/consumer/flatmates/live-posting.spec.js',
        /* The contact box is rendered twice on the detail page and which copy answers `Request number` is
           layout, so a desktop run proves nothing; the exhausted upsell is a modal, likeliest to break narrow. */
        '**/consumer/services/referral-rewards.spec.js',
        '**/platform/help/live-centre.spec.js',
        '**/platform/help/live-i18n-urls.spec.js',
        '**/platform/live-i18n.spec.js',
      ],
    },
    {
      /* Low-end Android baseline: the realistic median device in India, and the width where bottom chrome and
         tap targets break first. `tests/mobile/**` only — this stresses the chrome, not the whole suite again. */
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
      VITE_API_BASE: '/api',
      VITE_PROXY_TARGET: `http://localhost:${API_PORT}`,
    },
  },
});
