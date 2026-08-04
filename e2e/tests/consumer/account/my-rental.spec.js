// @ts-check
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const TENANT = { name: 'Test Tenant', mobile: '9700055001', email: '', role: 'buyer', joinedAt: Date.now() };
const OWNER = { name: 'Owner Only', mobile: '9800055002', email: '', role: 'owner', joinedAt: Date.now() };
const LISTING = {
  id: 'L-OWN-1', title: 'Owner 2 BHK, Baner', locality: 'Baner', deal: 'rent',
  price: 25000, status: 'approved', real: true, ownerMobile: '9800055002', views: 3,
};

async function login(page, user, { listings } = {}) {
  await page.addInitScript(({ u, l }) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    if (l) localStorage.setItem('puneNestListings:' + u.mobile, JSON.stringify(l));
  }, { u: user, l: listings || null });
}

test.describe('My Rental (tenant hub)', () => {
  test('a tenant sees the My Rental tab and an empty state with a demo loader', async ({ page }) => {
    await login(page, TENANT);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /My Rental/ }).first()).toBeVisible();

    await page.goto(`${BASE}/dashboard#rental`, { waitUntil: 'networkidle' });
    await expect(page.getByText('No rental on PuneNest yet')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Load a demo rental/i })).toBeVisible();
  });

  test('a pure owner with no rental does NOT see the My Rental tab', async ({ page }) => {
    await login(page, OWNER, { listings: [LISTING] });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    // Owner management tabs are present…
    await expect(page.getByRole('button', { name: /^Requests$/ }).first()).toBeVisible();
    // …but "My Rental" is not, since the owner rents nothing.
    await expect(page.getByRole('button', { name: /My Rental/ })).toHaveCount(0);
  });

  test('loading the demo rental populates every feature', async ({ page }) => {
    await login(page, TENANT);
    await page.goto(`${BASE}/dashboard#rental`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Load a demo rental/i }).click();

    // Rented-home card
    await expect(page.getByText('2 BHK in Rohan Leher, Baner')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Rahul Deshmukh').first()).toBeVisible();

    // Online rent payment isn't live yet — the Pay-rent CTAs are surfaced as
    // "Coming soon" and now link into /pay-rent, which hosts an honest
    // coming-soon page (no longer bounces back to home).
    await expect(page.getByText(/Coming soon/i).first()).toBeVisible();
    await expect(page.locator('a[href^="/pay-rent"]').first()).toBeVisible();

    // Payment history — two seeded months, each with an HRA receipt affordance
    await expect(page.getByText('Rent payments')).toBeVisible();
    await expect(page.getByRole('button', { name: /HRA receipt/i })).toHaveCount(2);

    // Rent agreement registered
    await expect(page.getByText('Registered').first()).toBeVisible();

    // Verified-Tenant score card
    await expect(page.getByText('Verified-Tenant score')).toBeVisible();

    // Quick actions present
    await expect(page.getByText('Deposit EMIs')).toBeVisible();
    await expect(page.getByText('Rent agreement').first()).toBeVisible();
  });

  test('the demo rental persists across reloads and can be removed', async ({ page }) => {
    await login(page, TENANT);
    await page.goto(`${BASE}/dashboard#rental`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Load a demo rental/i }).click();
    await expect(page.getByText('2 BHK in Rohan Leher, Baner')).toBeVisible({ timeout: 10000 });

    // Persists
    await page.reload({ waitUntil: 'networkidle' });
    await page.goto(`${BASE}/dashboard#rental`, { waitUntil: 'networkidle' });
    await expect(page.getByText('2 BHK in Rohan Leher, Baner')).toBeVisible({ timeout: 10000 });

    // Remove → back to empty state
    await page.getByRole('button', { name: /Remove demo rental/i }).click();
    await expect(page.getByText('No rental on PuneNest yet')).toBeVisible({ timeout: 10000 });
  });
});
