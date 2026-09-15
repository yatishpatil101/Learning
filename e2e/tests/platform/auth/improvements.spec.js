import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { E2E_OTP, completeProfileIfAsked, seedConsent, signIn, uniqueMobile, forgetSessions } from '../../../helpers/liveAuth.js';

/* The sign-in / sign-up *screens* against the live API: gated-visitor copy, real links, one primary
   action at a time, and the storage tier a session lands in — see `docs/flows/consumer/auth.md`. */

const cityScoped = (page, city) =>
  page.addInitScript((c) => localStorage.setItem('draazyCity', c), city);

test.describe('the auth panels are city-aware, and honest about cities we have not launched in', () => {
  /* City selection is client state; what a panel claims about a city is not. These move again when
     `cities.live` becomes a server fact — see `docs/flows/consumer/auth.md`. */

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

  /* `review` is the newest reason, and the one whose copy carries a consequence rather than a
     convenience: a review is published under the reviewer's name, which is the actual reason an
     account is required. A reason with no entry in the copy table falls back to the default
     heading, so this asserts the specific string and not merely that a heading exists. */
  test('an explicit review reason', async ({ page }) => {
    await page.goto('/signin?reason=review&next=%2Flocality%2Fbaner');
    await expect(page.getByRole('heading', { name: /post your review/i })).toBeVisible();
  });

  /* Four property-page actions that contact nobody — offer, deal update, papers, more photos — each
     need their own reason: the gate's toast survives the navigation, so a borrowed `contact` puts
     two different explanations on screen at once. */
  for (const [reason, heading] of [['offer', /make your offer/i], ['docs', /request documents/i]]) {
    test(`an explicit ${reason} reason`, async ({ page }) => {
      await page.goto(`/signin?reason=${reason}&next=%2Fproperty%2Fp5145`);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    });
  }

  test('the reason is inferred from the destination when not stated', async ({ page }) => {
    await page.goto(`/signin?next=${encodeURIComponent('/checkout?plan=pro')}`);
    await expect(page.getByRole('heading', { name: /complete your purchase/i })).toBeVisible();
  });

  test('sign-up surfaces the same reason as a banner', async ({ page }) => {
    await page.goto('/signup?reason=contact');
    await expect(page.getByText(/contact the owner/i)).toBeVisible();
  });
});

test.describe('a hostile `next` cannot steer a freshly-authenticated session off-site', () => {
  /* Each payload defeats a different naive guard, and the *landing* is asserted rather than the
     origin — see `docs/flows/consumer/auth.md`. */
  const HOSTILE = ['//evil.example', '/%5Cevil.example', '/%09/evil.example'];

  for (const next of HOSTILE) {
    test(`consumer sign-in ignores ?next=${next}`, async ({ page }) => {
      await signIn(page, uniqueMobile(), { next });
      await expect(page).toHaveURL(/\/listings/);
    });
  }

  for (const next of ['/%2573ignin', '/%2573ignup', '/%2573taff-login', '/%252e%252e%2fsignin']) {
    test(`consumer sign-in rejects encoded auth-screen ?next=${next}`, async ({ page }) => {
      await signIn(page, uniqueMobile(), { next });
      await expect(page).toHaveURL(/\/listings/);
    });
  }

  test('staff sign-in ignores one too, and it is the same guard', async ({ page }) => {
    /* `/staff-login` reaches the guard by a different route — it filters `next` by role too. One
       payload suffices now both doors call the same function; the point is that they still do. */
    await signIn(page, ACTORS.admin, { screen: 'staff', role: /Administrator/, next: '/%5Cevil.example' });
    await expect(page).toHaveURL(/\/admin/);
  });
});

test('signing in lands a new account on the listings, the same place signing up does', async ({ page }) => {
  const mobile = uniqueMobile();
  // Driving the form by hand means opting into the protection `signIn` gets for free, and this is a
  // guest test — the only kind that ever sees the consent bar it suppresses.
  await seedConsent(page);
  await page.goto('/signin');
  await page.locator('#signin-mobile').fill(mobile);
  await page.getByRole('button', { name: /Send OTP/i }).click();

  /* An account-less number still proceeds to OTP rather than bouncing to /signup: the live API
     provisions on first verified login — see `docs/flows/consumer/auth.md`. */
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await expect(page).toHaveURL(/\/signin/);

  for (let i = 0; i < 6; i++) await page.getByLabel(`OTP digit ${i + 1}`).fill(E2E_OTP[i]);
  await page.getByRole('button', { name: /Verify & Sign In/i }).click();
  /* Asserted rather than merely tolerated: if the name step stopped appearing for a new account,
     this would return false and the test would still land on `/listings`. */
  expect(await completeProfileIfAsked(page)).toBe(true);
  await page.waitForURL('**/listings');
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
    await seedConsent(page); // hand-driven guest sign-in; see the note on the test above
    await page.goto('/signin');
    await page.locator('#signin-mobile').fill(mobile);
    await page.getByRole('checkbox').uncheck();
    await page.getByRole('button', { name: /Send OTP/i }).click();
    for (let i = 0; i < 6; i++) await page.getByLabel(`OTP digit ${i + 1}`).fill(E2E_OTP[i]);
    await page.getByRole('button', { name: /Verify & Sign In/i }).click();
    /* Completed rather than avoided with a seeded mobile: the profile patch is a second write
       through the same session, so going past it proves the patch did not re-scope the tiers. */
    expect(await completeProfileIfAsked(page)).toBe(true);
    await page.waitForURL('**/listings');

    const tiers = await page.evaluate(() => ({
      userLocal: localStorage.getItem('draazyUser'),
      userSession: sessionStorage.getItem('draazyUser'),
      tokensLocal: localStorage.getItem('draazyTokens'),
      tokensSession: sessionStorage.getItem('draazyTokens'),
    }));

    expect(tiers.userLocal).toBeNull();
    expect(tiers.userSession).toContain(mobile);
    /* One `remember` flag scopes both stores so a session cannot be half-scoped; only the access
       token is in reach from here — see `docs/flows/consumer/auth.md`. */
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

    /* Against a real OTP the demo hint is a lie no other gate can catch — nothing throws, the
       screen just tells people the wrong thing. */
    await expect(page.getByText(/enter any 6 digits/i)).toHaveCount(0);
  });
});
