import { test, expect } from '../../../fixtures/live.js';
import { E2E_OTP, uniqueMobile, forgetSessions } from '../../../helpers/liveAuth.js';

/* The sign-in / sign-up surface itself, against the live API.
 *
 * Almost none of this spec is about auth *state* — it is about the screens: the copy a gated
 * visitor is shown, the links being real, one primary action at a time, and the storage tier a
 * session lands in. That is exactly why it survived the migration nearly intact while the specs
 * around it lost half their tests: none of it was ever the mock's answer, it was the app's.
 *
 * Three seams did change, and each is worth naming because each is a place the live app is
 * deliberately *different* rather than merely re-plumbed:
 *
 *   1. **User existence.** The seeded spec pre-loaded `puneNestUsers` so a number would be
 *      "known". The live API has no such endpoint on purpose — "does this mobile exist?" answered
 *      publicly is a user-enumeration oracle — and provisions an account on first verified login.
 *      So the fixture is gone and, with it, the whole known/unknown distinction the mock enforced.
 *   2. **The signups flag.** Written through `PUT /admin/settings` and read back through the public
 *      `GET /flags`, rather than poked into the client's own store. Nothing in the test now touches
 *      the value under assertion.
 *   3. **The demo-mode hint is inverted.** `Signin.jsx` renders "enter any 6 digits" only when auth
 *      is *not* live. The seeded spec asserted it appears; this one asserts it does not, which is
 *      the assertion worth having — shipping a "type anything" hint over a real OTP is the kind of
 *      copy that survives to production precisely because nothing fails when it does.
 */

const cityScoped = (page, city) =>
  page.addInitScript((c) => localStorage.setItem('puneNestCity', c), city);

test.describe('the auth panels are city-aware, and honest about cities we have not launched in', () => {
  /* City selection is still client state; what the panel says about a city is not. These three
   * move again when the cities/geo work lands (`cities.live` becomes a server fact) — recorded in
   * `docs/migration/README.md` under decision 2 rather than left as a surprise. */

  test('Pune shows the canonical stats the home page shows', async ({ page }) => {
    await cityScoped(page, 'Pune');
    await page.goto('/signin');

    await expect(page.getByRole('heading', { name: /Find Your Perfect.*in Pune/i })).toBeVisible();
    await expect(page.getByText('11,240+')).toBeVisible();
    // The old hand-written 150+ must not creep back; the figures have one source.
    await expect(page.getByText('150+')).toHaveCount(0);
  });

  test('a city we have not launched in says so, and borrows no numbers', async ({ page }) => {
    await cityScoped(page, 'Mumbai');
    await page.goto('/signin');

    await expect(page.getByRole('heading', { name: /Find Your Perfect.*in Mumbai/i })).toBeVisible();
    await expect(page.getByText(/launching in Mumbai soon/i)).toBeVisible();
    /* The important half. Pune's inventory count next to "launching in Mumbai soon" is not a
     * cosmetic slip — it is a claim about stock that does not exist. */
    await expect(page.getByText('11,240+')).toHaveCount(0);
  });

  test('sign-up reflects the active city too', async ({ page }) => {
    await cityScoped(page, 'Bengaluru');
    await page.goto('/signup');

    await expect(page.getByRole('heading', { name: /unlock Bengaluru's best/i })).toBeVisible();
  });
});

test('sign-up offers exactly one primary action at a time', async ({ page }) => {
  const mobile = uniqueMobile();
  await page.goto(`/signup?mobile=${mobile}&new=1`);

  await expect(page.getByRole('button', { name: /Send OTP/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Create Account/i })).toHaveCount(0);

  await page.locator('input[placeholder="Enter your full name"]').fill('Single Btn');
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Send OTP/i }).click();

  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await expect(page.getByRole('button', { name: /Create Account/i })).toBeVisible();
  /* Both directions, because two enabled primaries is the failure this guards: a form where "Send
   * OTP" survives alongside "Create Account" invites a second OTP that invalidates the first. */
  await expect(page.getByRole('button', { name: /Send OTP/i })).toHaveCount(0);
});

test('the auth pages have no dead links and their legal links resolve', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
  await expect(page.locator('form').getByRole('link', { name: 'Need Help?' })).toHaveAttribute('href', '/contact');

  await page.goto('/signup');
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
  await expect(page.locator('form').getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
  await expect(page.locator('form').getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
});

test.describe('a gated visitor is told why they are being asked to sign in', () => {
  test('an explicit save reason', async ({ page }) => {
    await page.goto('/signin?reason=save&next=%2Flistings');
    await expect(page.getByRole('heading', { name: /save this home/i })).toBeVisible();
  });

  test('an explicit contact reason', async ({ page }) => {
    await page.goto('/signin?reason=contact&next=%2Fowner%2F1');
    await expect(page.getByRole('heading', { name: /contact the owner/i })).toBeVisible();
  });

  test('the reason is inferred from the destination when not stated', async ({ page }) => {
    await page.goto(`/signin?next=${encodeURIComponent('/checkout?plan=pro')}`);
    await expect(page.getByRole('heading', { name: /complete your purchase/i })).toBeVisible();
  });

  test('sign-up surfaces the same reason as a banner', async ({ page }) => {
    await page.goto('/signup?reason=contact');
    await expect(page.getByText(/contact the owner/i)).toBeVisible();
  });
});

test('signing in lands on the dashboard, the same place signing up does', async ({ page }) => {
  const mobile = uniqueMobile();
  await page.goto('/signin');
  await page.locator('#signin-mobile').fill(mobile);
  await page.getByRole('button', { name: /Send OTP/i }).click();

  /* A number with no account behind it, and it still proceeds to OTP here rather than bouncing to
   * /signup. That is the live API's design showing through: it provisions on first verified login
   * and has deliberately no "does this mobile exist?" endpoint, because answering that publicly
   * enumerates users. The mock's bounce is the branch that dies in P5c. */
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await expect(page).toHaveURL(/\/signin/);

  for (let i = 0; i < 6; i++) await page.getByLabel(`OTP digit ${i + 1}`).fill(E2E_OTP[i]);
  await page.getByRole('button', { name: /Verify & Sign In/i }).click();
  await page.waitForURL('**/dashboard');
});

test.describe('the signups flag closes the front door', () => {
  test('off: the Sign Up link is gone and the route is not reachable', async ({ page, flags }) => {
    await flags.disable('signupsEnabled');
    await page.goto('/signin');

    await expect(page.getByRole('link', { name: 'Sign Up' })).toHaveCount(0);
    /* Hiding the link is not closing the door. The route guard is the half that matters, and the
     * half a link-only assertion would have let regress. */
    await page.goto('/signup');
    await expect(page).not.toHaveURL(/\/signup/);
  });

  test('on: the Sign Up link is there', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.getByRole('link', { name: 'Sign Up' })).toBeVisible();
  });
});

test.describe('polish that is really about safety', () => {
  test('unchecking "remember this device" keeps the whole session tab-scoped', async ({ page }) => {
    await forgetSessions();
    const mobile = uniqueMobile();
    await page.goto('/signin');
    await page.locator('#signin-mobile').fill(mobile);
    await page.getByRole('checkbox').uncheck();
    await page.getByRole('button', { name: /Send OTP/i }).click();
    for (let i = 0; i < 6; i++) await page.getByLabel(`OTP digit ${i + 1}`).fill(E2E_OTP[i]);
    await page.getByRole('button', { name: /Verify & Sign In/i }).click();
    await page.waitForURL('**/dashboard');

    const tiers = await page.evaluate(() => ({
      userLocal: localStorage.getItem('puneNestUser'),
      userSession: sessionStorage.getItem('puneNestUser'),
      tokensLocal: localStorage.getItem('puneNestTokens'),
      tokensSession: sessionStorage.getItem('puneNestTokens'),
    }));

    expect(tiers.userLocal).toBeNull();
    expect(tiers.userSession).toContain(mobile);
    /* The tokens are the assertion the seeded spec could not make, because on mocks there were
     * none. `lib/auth.js` passes one `remember` flag to both stores precisely so a session cannot
     * be half-scoped; a tab-scoped user profile sitting next to a remembered *access* token is a
     * shared-computer leak that looks, from the UI, exactly like a signed-out browser.
     *
     * Only the access token is in reach here. The refresh token is an `HttpOnly` cookie, so this
     * spec cannot see it and it is scoped by the server instead — the same `remember` flag is sent
     * on login and decides whether the cookie gets a `Max-Age` or dies with the browser. Asserting
     * the storage half is still worth doing: it is the half a script on the page can read. */
    expect(tiers.tokensLocal).toBeNull();
    expect(tiers.tokensSession).toBeTruthy();
  });

  test('the mobile field is focused on sign in', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('#signin-mobile')).toBeFocused();
  });

  test('the name field is focused on sign up', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('input[placeholder="Enter your full name"]')).toBeFocused();
  });

  test('the OTP step does NOT offer the demo-mode hint', async ({ page }) => {
    await page.goto('/signin');
    await page.locator('#signin-mobile').fill(uniqueMobile());
    await page.getByRole('button', { name: /Send OTP/i }).click();
    await expect(page.getByLabel('OTP digit 1')).toBeVisible();

    /* Inverted from the seeded version, which asserted the hint appears. Against a real OTP the
     * hint is a lie that costs a support ticket per user, and it is invisible to every other gate:
     * nothing throws, nothing 500s, the screen just tells people the wrong thing. */
    await expect(page.getByText(/enter any 6 digits/i)).toHaveCount(0);
  });
});
