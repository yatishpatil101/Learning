import { defineConfig, devices } from '@playwright/test';
import { NO_BACKEND } from './no-backend-specs.js';

const NB_PORT = process.env.NB_PORT;
const BASE_URL = NB_PORT ? `http://localhost:${NB_PORT}` : process.env.BASE_URL || 'http://localhost:5173';
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  forbidOnly: CI,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  retries: CI ? 2 : 1,
  // Cap workers: too many browsers against one Vite server look like product bugs.
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
      // Named explicitly rather than by exclusion: a spec that belongs to neither config runs nowhere and reports nothing.
      testMatch: NO_BACKEND,
    },
  ],
  webServer: process.env.BASE_URL && !NB_PORT
    ? undefined
    : {
        command: `npm --prefix ../frontend run dev${NB_PORT ? ` -- --port ${NB_PORT} --strictPort` : ''}`,
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !CI && !NB_PORT,
        env: NB_PORT ? { VITE_PROXY_TARGET: 'http://127.0.0.1:9' } : undefined,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
