import { test, expect } from '../../../fixtures/live.js';
import { E2E_OTP, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';

/* Locators here are scoped to `#root` on purpose.
 *
 * `frontend/index.html` ships a hidden `pmf-lead` form as a *sibling* of #root —
 * inert markup that exists so Netlify's deploy bot registers the form at build
 * time. It contains `<input type="tel" name="whatsapp">`, so an unscoped
 * `input[type="tel"]` matches two elements everywhere in the app and fails on
 * strict mode. Scoping to the React root is the fix that keeps working wherever
 * the form gains another field. */

async function fillOtp(page, code = E2E_OTP) {
  for (let i = 0; i < 6; i++) {
    await page.getByLabel(`OTP digit ${i + 1}`).fill(code[i]);
  }
}

test.describe('Auth: SSO ("or continue with") removed', () => {
  test('Sign In page shows no Google/Apple SSO', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.getByText(/or continue with/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Google' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Apple' })).toHaveCount(0);
    // Core mobile+OTP entry is still present.
    await expect(page.locator('#signin-mobile')).toBeVisible();
  });

  test('Sign Up page shows no Google/Apple SSO', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByText(/or continue with/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Google' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Apple' })).toHaveCount(0);
  });
});

test('Sign In does not disclose whether a number is registered', async ({ page }) => {
  /* The mock suite asserted the opposite of this — an unknown number bounced to `/signup` with the
   * mobile carried over. That convenience is only possible because the mock owns a local registry
   * it can consult for free. The live API deliberately has **no** "does this mobile exist?"
   * endpoint: answering it publicly is a user-enumeration oracle, so `Signin.jsx` gates the whole
   * branch behind `!authIsLive` (and `POST /auth/login` provisions the account on first verified
   * login instead). That branch dies with the mock in P5c, so what is worth pinning here is the
   * live behaviour — an unregistered number and a registered one are indistinguishable from the
   * outside.
   *
   * Both halves are asserted in one test on purpose: "the unknown number went to OTP" is only
   * evidence of non-disclosure if a known number does exactly the same thing. */
  const unknown = uniqueMobile();
  const known = uniqueMobile();
  await apiLogin(known);                        // now a real, registered account

  for (const mobile of [unknown, known]) {
    await page.goto('/signin');
    await page.locator('#signin-mobile').fill(mobile);
    await page.getByRole('button', { name: /Send OTP/i }).click();
    // Same screen, same control, either way — no redirect to `/signup`, no "new here?" hint.
    await expect(page.getByLabel('OTP digit 1')).toBeVisible();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByText(/new to PuneNest/i)).toHaveCount(0);
  }
});

test('Sign Up enforces OTP, then lands on the dashboard and registers the account', async ({ page }) => {
  const mobile = uniqueMobile();
  await page.goto(`/signup?mobile=${mobile}&new=1`);
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
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  /* The account exists on the server.
   *
   * This used to read `localStorage.puneNestUsers` — the mock's registry, which the sign-up form
   * wrote to itself, so the assertion only ever proved the form could talk to its own browser tab.
   * Asking the API is the version that would fail if the registration never left the client.
   * `apiLogin` returns the stored profile, so the name is checked too: a row created with the
   * wrong name is a bug this spec should catch. */
  const { user } = await apiLogin(mobile);
  expect(user).toMatchObject({ mobile, name: 'Test User' });
});

test('After sign-up the destination opens scrolled to the very top', async ({ page }) => {
  // Seed cookie consent so the DPDPA banner doesn't intercept the bottom "Create Account" click.
  await page.addInitScript(() => {
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
  });
  // Small viewport so the tall auth form is scrollable.
  await page.setViewportSize({ width: 480, height: 700 });
  await page.goto(`/signup?mobile=${uniqueMobile()}&new=1`);
  await page.locator('input[placeholder="Enter your full name"]').fill('Scroll User');
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await fillOtp(page);
  // Scroll the auth page down before the redirect fires.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole('button', { name: /Create Account/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  // The redirect uses replace navigation — the page must still open at the top.
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeLessThan(5);
});
