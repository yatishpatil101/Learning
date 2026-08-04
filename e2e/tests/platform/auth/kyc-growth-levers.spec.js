// @ts-check
import { test, expect } from '@playwright/test';

/* KYC growth levers (ADR-019, badge-not-gate). The dashboard Overview surfaces an
   OPT-IN "Get your Verified badge" card that opens the native-DigiLocker flow. It
   is a trust prompt, never a wall: it only shows to an unverified user, auto-hides
   once the badge is earned, and blocks nothing. This spec exercises the core
   verification funnel: impression → click → DigiLocker success → badge earned. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const USER = { name: 'Seeker Test', mobile: '9700000055', email: '', role: 'user', joinedAt: Date.now() };

async function login(page, user, { aadhaar = false } = {}) {
  await page.addInitScript(({ u, aad }) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    if (aad) localStorage.setItem('puneNestAadhaar:' + u.mobile, JSON.stringify({ verified: true, at: Date.now() }));
  }, { u: user, aad: aadhaar });
}

const badgeCta = (page) => page.getByTestId('verify-badge-cta');
const badgeModal = (page) => page.getByRole('dialog', { name: 'Get your Verified badge' });

test('an unverified user sees the opt-in badge CTA on the dashboard', async ({ page }) => {
  await login(page, USER);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

  await expect(badgeCta(page)).toBeVisible();
  await expect(badgeCta(page).getByText('Optional', { exact: false })).toBeVisible();
});

test('a verified user does NOT see the badge CTA (auto-hides once earned)', async ({ page }) => {
  await login(page, USER, { aadhaar: true });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

  await expect(badgeCta(page)).toHaveCount(0);
});

test('the badge funnel completes via DigiLocker — badge earned and CTA disappears', async ({ page }) => {
  await login(page, USER);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

  await page.getByTestId('verify-badge-btn').click();

  // The DigiLocker opt-in flow opens (never an Aadhaar-on-PuneNest form).
  await expect(badgeModal(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with DigiLocker' })).toBeVisible();

  // Complete the mock DigiLocker round-trip.
  await page.getByRole('button', { name: 'Continue with DigiLocker' }).click();

  // Badge earned → modal closes, the CTA auto-hides, and the flag is persisted.
  await expect(badgeModal(page)).toHaveCount(0, { timeout: 10000 });
  await expect(badgeCta(page)).toHaveCount(0);
  const badge = await page.evaluate((m) => JSON.parse(localStorage.getItem('puneNestAadhaar:' + m) || 'null'), USER.mobile);
  expect(badge && badge.verified).toBe(true);
});

test('the badge is optional — dismissing DigiLocker keeps the user on the dashboard, nothing gated', async ({ page }) => {
  await login(page, USER);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

  await page.getByTestId('verify-badge-btn').click();
  await expect(badgeModal(page)).toBeVisible();

  // "Maybe later" closes the flow without earning a badge — no wall, no redirect.
  await page.getByRole('button', { name: 'Maybe later' }).click();
  await expect(badgeModal(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(badgeCta(page)).toBeVisible();
  const badge = await page.evaluate((m) => localStorage.getItem('puneNestAadhaar:' + m), USER.mobile);
  expect(badge).toBeNull();
});
