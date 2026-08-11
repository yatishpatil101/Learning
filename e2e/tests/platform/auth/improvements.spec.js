import { test, expect } from '@playwright/test';
import { appReady } from '../../../helpers/app.js';

const BASE = 'http://localhost:5173';

const setCity = (page, city) =>
  page.addInitScript((c) => localStorage.setItem('puneNestCity', c), city);

test.describe('Auth panels are city-aware (mirrors the home page)', () => {
  test('Sign In panel reflects Pune with canonical stats', async ({ page }) => {
    await setCity(page, 'Pune');
    await page.goto(`${BASE}/signin`);
    await expect(page.getByRole('heading', { name: /Find Your Perfect.*in Pune/i })).toBeVisible();
    // Canonical STATS (same figures as the home page), not the old 10K+/5K+/150+.
    await expect(page.getByText('11,240+')).toBeVisible();
    await expect(page.getByText('150+')).toHaveCount(0);
  });

  test('Sign In panel switches to a non-launched city with honest copy', async ({ page }) => {
    await setCity(page, 'Mumbai');
    await page.goto(`${BASE}/signin`);
    await expect(page.getByRole('heading', { name: /Find Your Perfect.*in Mumbai/i })).toBeVisible();
    await expect(page.getByText(/launching in Mumbai soon/i)).toBeVisible();
    // No stale Pune numbers or localities leak into a city we have no data for.
    await expect(page.getByText('11,240+')).toHaveCount(0);
  });

  test('Sign Up heading reflects the active city', async ({ page }) => {
    await setCity(page, 'Bengaluru');
    await page.goto(`${BASE}/signup`);
    await expect(page.getByRole('heading', { name: /unlock Bengaluru's best/i })).toBeVisible();
  });
});

test('Sign Up shows a single primary action before OTP (no redundant button)', async ({ page }) => {
  await page.goto(`${BASE}/signup?mobile=9812300011&new=1`);
  // Before OTP: only "Send OTP" — "Create Account" must not be present yet.
  await expect(page.getByRole('button', { name: /Send OTP/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Create Account/i })).toHaveCount(0);
  // Fill required fields and send OTP; now the primary submit appears.
  await page.locator('input[placeholder="Enter your full name"]').fill('Single Btn');
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await expect(page.getByRole('button', { name: /Create Account/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Send OTP/i })).toHaveCount(0);
});

test('Auth pages have no dead ("#") links and legal links resolve', async ({ page }) => {
  await page.goto(`${BASE}/signin`);
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
  await expect(page.locator('form').getByRole('link', { name: 'Need Help?' })).toHaveAttribute('href', '/contact');

  await page.goto(`${BASE}/signup`);
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
  await expect(page.locator('form').getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
  await expect(page.locator('form').getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
});

// ----------- Items 4�7: intent, redirect, flags, polish -----------

const OTP = '123456';
async function fillOtp(page) {
  for (let i = 0; i < 6; i++) await page.getByLabel(`OTP digit ${i + 1}`).fill(OTP[i]);
}
const seedUser = (page, mobile) =>
  page.addInitScript((m) => {
    localStorage.setItem('puneNestUsers', JSON.stringify([{ name: 'Reg User', mobile: m, email: '', role: 'buyer', joinedAt: Date.now() }]));
  }, mobile);

async function setSignupsFlag(page, value) {
  await page.goto(`${BASE}/`);
  // The store lands ~a second after any navigation wait resolves (D129); without this the
  // evaluate found nothing and returned silently, leaving signups at their default.
  await appReady(page);
  await page.evaluate((v) => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
    if (!db) throw new Error('mock store missing after appReady()');
    db.settings = db.settings || {};
    db.settings.flags = db.settings.flags || {};
    db.settings.flags.signupsEnabled = v;
    localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
    window.dispatchEvent(new CustomEvent('punenest-settings-change'));
  }, value);
}

test.describe('Item 4 � contextual gate copy', () => {
  test('explicit reason=save is reflected on Sign In', async ({ page }) => {
    await page.goto(`${BASE}/signin?reason=save&next=%2Flistings`);
    await expect(page.getByRole('heading', { name: /save this home/i })).toBeVisible();
  });

  test('explicit reason=contact is reflected on Sign In', async ({ page }) => {
    await page.goto(`${BASE}/signin?reason=contact&next=%2Fowner%2F1`);
    await expect(page.getByRole('heading', { name: /contact the owner/i })).toBeVisible();
  });

  test('reason is inferred from the next path when not explicit', async ({ page }) => {
    await page.goto(`${BASE}/signin?next=${encodeURIComponent('/checkout?plan=pro')}`);
    await expect(page.getByRole('heading', { name: /complete your purchase/i })).toBeVisible();
  });

  test('Sign Up surfaces the gate reason as a banner', async ({ page }) => {
    await page.goto(`${BASE}/signup?reason=contact`);
    await expect(page.getByText(/contact the owner/i)).toBeVisible();
  });
});

test('Item 5 � Sign In lands on the dashboard (consistent with Sign Up)', async ({ page }) => {
  await seedUser(page, '9876500055');
  await page.goto(`${BASE}/signin`);
  await page.locator('#signin-mobile').fill('9876500055');
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await fillOtp(page);
  await page.getByRole('button', { name: /Verify & Sign In/i }).click();
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 8000 });
});

test.describe('Item 5 � signupsEnabled flag', () => {
  test('when OFF: Sign Up link is hidden and unknown numbers stay on Sign In', async ({ page }) => {
    await setSignupsFlag(page, false);
    await page.goto(`${BASE}/signin`);
    await expect(page.getByRole('link', { name: 'Sign Up' })).toHaveCount(0);
    // An unknown number must NOT bounce to /signup � it proceeds to OTP here.
    await page.locator('#signin-mobile').fill('9811122233');
    await page.getByRole('button', { name: /Send OTP/i }).click();
    await expect(page.getByLabel('OTP digit 1')).toBeVisible();
    await expect(page).toHaveURL(/\/signin/);
  });

  test('when ON (default): Sign Up link is present', async ({ page }) => {
    await page.goto(`${BASE}/signin`);
    await expect(page.getByRole('link', { name: 'Sign Up' })).toBeVisible();
  });
});

test.describe('Item 6 � polish', () => {
  test('"Remember this device" unchecked keeps the session tab-scoped', async ({ page }) => {
    await seedUser(page, '9876500066');
    await page.goto(`${BASE}/signin`);
    await page.locator('#signin-mobile').fill('9876500066');
    await page.getByRole('checkbox').uncheck();
    await page.getByRole('button', { name: /Send OTP/i }).click();
    await fillOtp(page);
    await page.getByRole('button', { name: /Verify & Sign In/i }).click();
    await page.waitForURL(`${BASE}/dashboard`, { timeout: 8000 });
    const local = await page.evaluate(() => localStorage.getItem('puneNestUser'));
    const session = await page.evaluate(() => sessionStorage.getItem('puneNestUser'));
    expect(local).toBeNull();
    expect(session).toContain('9876500066');
  });

  test('mobile field is autofocused on Sign In', async ({ page }) => {
    await page.goto(`${BASE}/signin`);
    await expect(page.locator('#signin-mobile')).toBeFocused();
  });

  test('name field is autofocused on Sign Up', async ({ page }) => {
    await page.goto(`${BASE}/signup`);
    await expect(page.locator('input[placeholder="Enter your full name"]')).toBeFocused();
  });

  test('OTP step shows a demo hint', async ({ page }) => {
    await seedUser(page, '9876500077');
    await page.goto(`${BASE}/signin`);
    await page.locator('#signin-mobile').fill('9876500077');
    await page.getByRole('button', { name: /Send OTP/i }).click();
    await expect(page.getByText(/enter any 6 digits/i)).toBeVisible();
  });
});
