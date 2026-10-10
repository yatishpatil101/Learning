import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { E2E_OTP, completeProfileIfAsked, seedConsent, signIn, uniqueMobile, forgetSessions } from '../../../helpers/liveAuth.js';

// Live auth screens cover gated copy, real links, primary action and storage tier.
test('the auth panels are city-aware, and honest about cities we have not launched in', async ({ page }) => {
  // City selection is client state; what a panel claims about a city is not.
  const inCity = async (city, path) => {
    await page.goto(path);
    await page.evaluate((c) => localStorage.setItem('draazyCity', c), city);
    await page.goto(path);
  };

  await test.step('Pune shows the launch facts the home page shows, and no invented counts', async () => {
    await inCity('Pune', '/signin');
    await expect(page.getByRole('heading', { name: /Find Your Perfect.*in Pune/i })).toBeVisible();
    await expect(page.getByText('Pune locality guides')).toBeVisible();
    await expect(page.getByText('11,240+')).toHaveCount(0);
    await expect(page.getByText('Ravi Patil')).toHaveCount(0);
  });

  await test.step('a city we have not launched in says so, and borrows no numbers', async () => {
    await inCity('Mumbai', '/signin');
    await expect(page.getByRole('heading', { name: /Find Your Perfect.*in Mumbai/i })).toBeVisible();
    await expect(page.getByText(/launching in Mumbai soon/i)).toBeVisible();
    // The important half.
    await expect(page.getByText('Pune locality guides')).toHaveCount(0);
  });

  await test.step('sign-up reflects the active city too', async () => {
    // Hiding the link is not closing the door.
    await inCity('Bengaluru', '/signup');
    await expect(page.getByRole('heading', { name: /unlock Bengaluru's best/i })).toBeVisible();
  });
});
test('sign-up offers exactly one primary action at a time', async ({ page }) => {
  const mobile = uniqueMobile();
  await page.goto(`/signup?mobile=${mobile}&new=1`);

  await expect(page.getByRole('button', { name: /^Send OTP$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Create Account/i })).toHaveCount(0);

  await page.locator('input[placeholder="Enter your full name"]').fill('Single Btn');
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /^Send OTP$/i }).click();

  // Account-less numbers still reach OTP because verified login provisions users.
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await expect(page.getByRole('button', { name: /Create Account/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Send OTP$/i })).toHaveCount(0);
});

test('the auth pages have no dead links, resolve their legal links and focus their first field', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.locator('#signin-mobile')).toBeFocused();
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
  await expect(page.locator('form').getByRole('link', { name: 'Need Help?' })).toHaveAttribute('href', '/contact');

  await page.goto('/signup');
  await expect(page.locator('input[placeholder="Enter your full name"]')).toBeFocused();
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
  await expect(page.locator('form').getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
  await expect(page.locator('form').getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
});

test('a gated visitor is told why they are being asked to sign in', async ({ page }) => {
  // Review gates need consequence copy because reviews publish under the user's name; non-contact
  // actions need distinct reasons because gate toasts survive navigation.
  const reasons = [
    ['an explicit save reason', '/signin?reason=save&next=%2Flistings', /save this home/i],
    ['an explicit contact reason', '/signin?reason=contact&next=%2Fowner%2F1', /contact the owner/i],
    ['an explicit review reason', '/signin?reason=review&next=%2Flocality%2Fbaner', /post your review/i],
    ['an explicit offer reason', '/signin?reason=offer&next=%2Fproperty%2Fp5145', /make your offer/i],
    ['an explicit docs reason', '/signin?reason=docs&next=%2Fproperty%2Fp5145', /request documents/i],
    ['the reason is inferred from the destination when not stated', `/signin?next=${encodeURIComponent('/checkout?plan=pro')}`, /complete your purchase/i],
  ];
  for (const [name, url, heading] of reasons) {
    await test.step(name, async () => {
      await page.goto(url);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    });
  }

  await test.step('sign-up surfaces the same reason as a banner', async () => {
    await page.goto('/signup?reason=contact');
    await expect(page.getByText(/contact the owner/i)).toBeVisible();
  });
});
test.describe('a hostile `next` cannot steer a freshly-authenticated session off-site', () => {
  // Assert landing because each payload targets a different naive redirect guard.
  for (const next of ['//evil.example', '/%5Cevil.example', '/%09/evil.example']) {
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
    // `/staff-login` reaches the guard by a different route — it filters `next` by role too.
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

  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await expect(page).toHaveURL(/\/signin/);

  for (let i = 0; i < 6; i++) await page.getByLabel(`OTP digit ${i + 1}`).fill(E2E_OTP[i]);
  await page.getByRole('button', { name: /Verify & Sign In/i }).click();
  // Assert the name step so auto-skipping it cannot still pass on `/listings`.
  expect(await completeProfileIfAsked(page)).toBe(true);
  await page.waitForURL('**/listings');
});

test('the signups flag closes the front door', async ({ page, flags }) => {
  await page.goto('/signin');
  await expect(page.getByRole('link', { name: 'Sign Up' })).toBeVisible();

  await flags.disable('signupsEnabled');
  await page.goto('/signin');
  await expect(page.getByRole('link', { name: 'Sign Up' })).toHaveCount(0);
  await page.goto('/signup');
  await expect(page).not.toHaveURL(/\/signup/);
});
test.describe('polish that is really about safety', () => {
  test('unchecking "remember this device" keeps the whole session tab-scoped', async ({ page }) => {
    await forgetSessions();
    const mobile = uniqueMobile();
    await seedConsent(page);
    await page.goto('/signin');
    await page.locator('#signin-mobile').fill(mobile);
    await page.getByRole('checkbox').uncheck();
    await page.getByRole('button', { name: /Send OTP/i }).click();
    for (let i = 0; i < 6; i++) await page.getByLabel(`OTP digit ${i + 1}`).fill(E2E_OTP[i]);
    await page.getByRole('button', { name: /Verify & Sign In/i }).click();
    // Complete profile to prove the session survives the second write.
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
    // One remember flag scopes both stores; a session must not be half-scoped.
    expect(tiers.tokensLocal).toBeNull();
    expect(tiers.tokensSession).toBeTruthy();
  });

  test('the OTP step does NOT offer the demo-mode hint', async ({ page }) => {
    await page.goto('/signin');
    await page.locator('#signin-mobile').fill(uniqueMobile());
    await page.getByRole('button', { name: /Send OTP/i }).click();
    await expect(page.getByLabel('OTP digit 1')).toBeVisible();

    // Real OTP screens must not show the demo hint.
    await expect(page.getByText(/enter any 6 digits/i)).toHaveCount(0);
  });
});
