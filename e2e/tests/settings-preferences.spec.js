// @ts-check
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const SEEKER = { name: 'Seeker Test', mobile: '9700000055', email: '', role: 'user', joinedAt: Date.now() };
const OWNER = { name: 'Owner Test', mobile: '9800000055', email: '', role: 'owner', joinedAt: Date.now() };
const LISTING = {
  id: 'L-SET-1', title: 'Test 2 BHK, Baner', locality: 'Baner', deal: 'rent',
  price: 25000, status: 'approved', real: true, ownerMobile: '9800000055', views: 3,
};

async function login(page, user, { listings } = {}) {
  await page.addInitScript(({ u, l }) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    if (l) localStorage.setItem('puneNestListings:' + u.mobile, JSON.stringify(l));
  }, { u: user, l: listings || null });
}

test.describe('Dashboard settings', () => {
  test('the Profile & Settings tab renders the new setting cards', async ({ page }) => {
    await login(page, SEEKER);
    await page.goto(`${BASE}/dashboard#profile`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Notification Preferences' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Privacy & Account' })).toBeVisible();
  });

  test('notification channel toggle persists across reload', async ({ page }) => {
    await login(page, SEEKER);
    await page.goto(`${BASE}/dashboard#profile`, { waitUntil: 'networkidle' });
    const emailSwitch = page.getByRole('switch', { name: 'Email' });
    // Default is on — turn it off.
    await expect(emailSwitch).toHaveAttribute('aria-checked', 'true');
    await emailSwitch.click();
    await expect(emailSwitch).toHaveAttribute('aria-checked', 'false');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pnNotifPrefs:9700000055')));
    expect(stored.email).toBe(false);
    // Survives a reload.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('switch', { name: 'Email' })).toHaveAttribute('aria-checked', 'false');
  });

  test('Reduce motion applies a root class and persists', async ({ page }) => {
    await login(page, SEEKER);
    await page.goto(`${BASE}/dashboard#profile`, { waitUntil: 'networkidle' });
    await page.getByRole('switch', { name: 'Reduce motion' }).click();
    await expect(page.locator('html')).toHaveClass(/pn-reduce-motion/);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveClass(/pn-reduce-motion/);
  });

  test('Delete account requires typing DELETE to confirm', async ({ page }) => {
    await login(page, SEEKER);
    await page.goto(`${BASE}/dashboard#profile`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^Delete$/ }).click();
    await expect(page.getByRole('heading', { name: 'Delete your account?' })).toBeVisible();
    const confirm = page.getByRole('button', { name: /Delete forever/ });
    await expect(confirm).toBeDisabled();
    await page.getByPlaceholder('DELETE').fill('DELETE');
    await expect(confirm).toBeEnabled();
  });

  test('owner phone-privacy toggle shows for owners and persists', async ({ page }) => {
    await login(page, OWNER, { listings: [LISTING] });
    await page.goto(`${BASE}/dashboard#profile`, { waitUntil: 'networkidle' });
    const priv = page.getByRole('switch', { name: 'Keep my number private' });
    await expect(priv).toBeVisible();
    await priv.click();
    await expect(priv).toHaveAttribute('aria-checked', 'true');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pnOwnerPrefs:9800000055')));
    expect(stored.hideNumber).toBe(true);
  });

  test('language setting localizes the app (shell + Notifications)', async ({ page }) => {
    await login(page, SEEKER);
    // Persist Marathi as the device language (global i18n pref), then load.
    await page.addInitScript(() => {
      localStorage.setItem('pnLang', 'mr');
    });
    await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
    // Notifications page renders in Marathi, not English.
    await expect(page.getByRole('heading', { name: 'सूचना' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notifications' })).toHaveCount(0);
    await expect(page.getByText('तुमच्या शोधाशी ३ नवीन मालमत्ता जुळतात')).toBeVisible();
    // App shell (dashboard sidebar) is localized too — proves it's app-wide.
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'आढावा' })).toBeVisible();
  });

  test('changing language in Settings persists to pnLang and switches the app', async ({ page }) => {
    await login(page, SEEKER);
    await page.goto(`${BASE}/dashboard#profile`, { waitUntil: 'networkidle' });
    // Open the language dropdown and pick Marathi.
    await page.getByRole('button', { name: /App language/i }).click();
    await page.getByRole('option', { name: /मराठी/ }).click();
    // Global pref is written and the sidebar switches live.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('pnLang'))).toBe('mr');
    await expect(page.getByRole('button', { name: 'प्रोफाइल व सेटिंग्ज' })).toBeVisible();
  });
});
