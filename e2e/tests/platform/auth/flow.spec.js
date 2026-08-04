import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

/* Locators here are scoped to `#root` on purpose.
 *
 * `frontend/index.html` ships a hidden `pmf-lead` form as a *sibling* of #root —
 * inert markup that exists so Netlify's deploy bot registers the form at build
 * time. It contains `<input type="tel" name="whatsapp">`, so an unscoped
 * `input[type="tel"]` matches two elements everywhere in the app and fails on
 * strict mode. Scoping to the React root is the fix that keeps working wherever
 * the form gains another field. */

async function fillOtp(page, code = '123456') {
  for (let i = 0; i < 6; i++) {
    await page.getByLabel(`OTP digit ${i + 1}`).fill(code[i]);
  }
}

test.describe('Auth: SSO ("or continue with") removed', () => {
  test('Sign In page shows no Google/Apple SSO', async ({ page }) => {
    await page.goto(`${BASE}/signin`);
    await expect(page.getByText(/or continue with/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Google' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Apple' })).toHaveCount(0);
    // Core mobile+OTP entry is still present.
    await expect(page.locator('#signin-mobile')).toBeVisible();
  });

  test('Sign Up page shows no Google/Apple SSO', async ({ page }) => {
    await page.goto(`${BASE}/signup`);
    await expect(page.getByText(/or continue with/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Google' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Apple' })).toHaveCount(0);
  });
});

test('Sign In with an unknown number routes to Sign Up with the mobile carried over', async ({ page }) => {
  await page.goto(`${BASE}/signin`);
  await page.locator('#signin-mobile').fill('9876500011');
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await expect(page).toHaveURL(/\/signup\?/);
  await expect(page).toHaveURL(/mobile=9876500011/);
  // Mobile is prefilled on the sign-up form and the new-visitor banner is shown.
  await expect(page.locator('#signup-mobile')).toHaveValue('9876500011');
  await expect(page.getByText(/new to PuneNest/i)).toBeVisible();
});

test('Sign Up enforces OTP, then lands on the dashboard and registers the account', async ({ page }) => {
  await page.goto(`${BASE}/signup?mobile=9876500022&new=1`);
  await page.locator('input[placeholder="Enter your full name"]').fill('Test User');
  await page.locator('input[type="checkbox"]').check();

  // Clicking "Send OTP" reveals the OTP entry without registering/redirecting.
  // (The primary "Create Account" button only appears once OTP has been sent.)
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await expect(page).toHaveURL(/\/signup/);

  // Now complete OTP and create the account.
  await fillOtp(page);
  await page.getByRole('button', { name: /Create Account/i }).click();

  // Redirects to the dashboard hub after account creation (consistent with Sign In).
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 8000 });

  // The number is now in the registered-users store.
  const users = await page.evaluate(() => localStorage.getItem('puneNestUsers'));
  expect(users).toContain('9876500022');
});

test('A registered number proceeds to OTP on Sign In (not bounced to Sign Up)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('puneNestUsers', JSON.stringify([
      { name: 'Reg User', mobile: '9876500033', email: '', role: 'buyer', joinedAt: Date.now() },
    ]));
  });
  await page.goto(`${BASE}/signin`);
  await page.locator('#signin-mobile').fill('9876500033');
  await page.getByRole('button', { name: /Send OTP/i }).click();
  // Stays on Sign In and reveals the OTP entry.
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await expect(page).toHaveURL(/\/signin/);
});

test('After sign-up the destination opens scrolled to the very top', async ({ page }) => {
  // Seed cookie consent so the DPDPA banner doesn't intercept the bottom "Create Account" click.
  await page.addInitScript(() => {
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
  });
  // Small viewport so the tall auth form is scrollable.
  await page.setViewportSize({ width: 480, height: 700 });
  await page.goto(`${BASE}/signup?mobile=9876500044&new=1`);
  await page.locator('input[placeholder="Enter your full name"]').fill('Scroll User');
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await fillOtp(page);
  // Scroll the auth page down before the redirect fires.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole('button', { name: /Create Account/i }).click();
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 8000 });
  // The redirect uses replace navigation — the page must still open at the top.
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeLessThan(5);
});
