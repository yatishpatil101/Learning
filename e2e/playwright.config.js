import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { NO_BACKEND } from './no-backend-specs.js';

// Every spec runs against the live API, so a `live-` prefix carries no meaning and only breeds copies.
const prefixed = fs
  .readdirSync(new URL('./tests', import.meta.url), { recursive: true })
  .filter((f) => /(^|[\\/])live-[^\\/]*\.spec\.js$/.test(f));
if (prefixed.length) throw new Error(`Drop the "live-" prefix from: ${prefixed.join(', ')}`);

// **It resets a database**: prefer the `run-live-*.ps1` lanes, which pin port, database and app URL together.
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_PORT = process.env.API_PORT || '8081';
// run-fast.ps1 doubles this for parallel shards, where every backend shares the same CPU.
const TIMEOUT_SCALE = Math.max(1, Number(process.env.E2E_TIMEOUT_SCALE) || 1);

// `tests/mobile/**` is phone-only; the desktop project ignores the same expression.
const MOBILE = /[\\/]tests[\\/]mobile[\\/]/;

// Only suggestive (the backend is started by hand), but a backend that refused to boot reads as a flaky test.
if (!process.env.DRAAZY_DEV_MACHINE) {
  console.warn(
    '[live] DRAAZY_DEV_MACHINE is not set in this shell. If the backend was started without it, ' +
      'it refused to boot under the `dev` profile and every login below will time out. ' +
      'See docs/LOCAL_DEV.md.',
  );
}

export default defineConfig({
  testDir: './tests',
  // At the start rather than in a teardown, so a crashed run leaves its evidence intact.
  globalSetup: './global-setup.live.js',
  timeout: 60_000 * TIMEOUT_SCALE,
  expect: { timeout: 15_000 * TIMEOUT_SCALE },
  retries: 0,
  // The specs share seeded fixtures and a single session cache.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000 * TIMEOUT_SCALE,
    navigationTimeout: 20_000 * TIMEOUT_SCALE,
    // Pairs with VITE_POSTHOG_KEY below: PostHog loads for real, but nothing reaches PostHog unless a spec routes it.
    launchOptions: { args: ['--host-resolver-rules=MAP *.posthog.com ~NOTFOUND'] },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // A 48px tap target at 1280px is not evidence about a phone; `NO_BACKEND` belongs to the other config.
      testIgnore: [MOBILE, ...NO_BACKEND],
    },
    {
      /* `mobile-small` already runs all of `tests/mobile/**` at the stricter 360×640, so Pixel 7 only takes
         specs whose assertions change with width or fold height, plus the cross-viewport list. */
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: [
        '**/mobile/home-featured-first.spec.js',
        '**/mobile/home-flatmates-tile.spec.js',
        // Which contact-box copy answers `Request number` is layout; the exhausted upsell is likeliest to break narrow.
        '**/consumer/services/referral-rewards.spec.js',
        '**/platform/help/centre.spec.js',
        '**/platform/help/help-urls.spec.js',
        '**/platform/i18n.spec.js',
      ],
    },
    {
      // Low-end Android baseline, where bottom chrome and tap targets break first; most mobile specs run here.
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
      VITE_POSTHOG_KEY: 'phc_e2e',
    },
  },
});
