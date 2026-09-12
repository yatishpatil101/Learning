import { test, expect } from '../../../fixtures/live.js';
import { API, E2E_OTP, apiLogin, completeProfileIfAsked, seedConsent, signIn, uniqueMobile } from '../../../helpers/liveAuth.js';

/* Locators are scoped to `#root`: `index.html` ships a hidden `pmf-lead` form as a sibling of it for
   Netlify's build bot, so an unscoped `input[type="tel"]` matches two elements and fails strict mode. */
const WRONG_OTP = E2E_OTP === '111111' ? '222222' : '111111';

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
  /* Both halves in one test: "the unknown number went to OTP" is only evidence of non-disclosure if
     a known number does the same. See `docs/flows/consumer/auth.md`. */
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
    await expect(page.getByText(/new to Draazy/i)).toHaveCount(0);
  }
});

/* Asked after the OTP so the new-account branch is not an enumeration oracle, and asserted as a pair
   so it is a rule rather than a coincidence — see `docs/flows/consumer/auth.md`. */
test('a first-time account is asked for a name after the OTP, and only the first time', async ({ page }) => {
  const mobile = uniqueMobile();
  // The DPDPA bar would otherwise intercept the submit at the bottom of the card.
  await seedConsent(page);

  await page.goto('/signin');
  await page.locator('#signin-mobile').fill(mobile);
  await page.getByRole('button', { name: /Send OTP/i }).click();
  // Still nothing asked: an unknown number and a known one see the identical screen.
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await expect(page.locator('#profile-name')).toHaveCount(0);

  await fillOtp(page);
  await page.getByRole('button', { name: /Verify/i }).click();

  // …and now it is asked, because the server has just provisioned a nameless buyer.
  await expect(page.locator('#profile-name')).toBeVisible();
  await expect(page).toHaveURL(/\/signin/);
  await page.locator('#profile-name').fill('Priya Kulkarni');
  await page.getByRole('button', { name: /Continue/i }).click();
  /* Listings, not the dashboard: an account three seconds old has no activity, so the hub would open
     as a page of zeros. Sign Up applies the identical rule. */
  await page.waitForURL('**/listings', { timeout: 20_000 });

  /* Read back through the API: a save that only updated React state would satisfy any assertion
     made against this tab. */
  const { user } = await apiLogin(mobile);
  expect(user).toMatchObject({ mobile, name: 'Priya Kulkarni' });

  /* Drop the session rather than opening a second context, so the assertion is about the *account*.
     `addInitScript` re-seeds consent on the next load. */
  await page.context().clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/signin');
  await page.locator('#signin-mobile').fill(mobile);
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await fillOtp(page);
  await page.getByRole('button', { name: /Verify/i }).click();
  /* Reaching the dashboard IS the assertion: the name step is a full-screen replacement of this same
     card, so a named account arriving anywhere else could not have skipped it. */
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
});

test('Sign Up enforces OTP, then lands on the listings and registers the account', async ({ page }) => {
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

  // Redirects to the listings after account creation (consistent with Sign In: a sign-up is by
  // definition a brand-new account, so it gets the same landing a first-time sign-in gets).
  await page.waitForURL('**/listings', { timeout: 20_000 });

  // Verify server persistence to prevent a client-only success state.
  const { user } = await apiLogin(mobile);
  expect(user).toMatchObject({ mobile, name: 'Test User' });
});

test('Sign Up sends an established account to its dashboard unless a gated destination is explicit', async ({ page }) => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const named = await fetch(`${API}/auth/me`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Established Member' }),
  });
  expect(named.ok).toBe(true);

  await seedConsent(page);
  await page.goto(`/signup?mobile=${mobile}`);
  await page.locator('input[placeholder="Enter your full name"]').fill('Established Member');
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await fillOtp(page);
  await page.getByRole('button', { name: /Create Account/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  await page.goto(`/signup?mobile=${mobile}&next=${encodeURIComponent('/saved')}`);
  await page.locator('input[placeholder="Enter your full name"]').fill('Established Member');
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await fillOtp(page);
  await page.getByRole('button', { name: /Create Account/i }).click();
  await page.waitForURL('**/saved', { timeout: 20_000 });
});

test('After sign-up the destination opens scrolled to the very top', async ({ page }) => {
  // Seed cookie consent so the DPDPA banner doesn't intercept the bottom "Create Account" click.
  await page.addInitScript(() => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
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
  await page.waitForURL('**/listings', { timeout: 20_000 });
  // The redirect uses replace navigation — the page must still open at the top.
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeLessThan(5);
});

/* Both halves in one test — hiding the token is trivial if you break renewal, and vice versa. Only
   testable at browser level; see `docs/flows/consumer/auth.md`. */
test('the refresh token is unreadable by scripts, and the session renews anyway', async ({ page, context }) => {
  const mobile = uniqueMobile();
  await signIn(page, mobile);
  /* The dashboard is guarded, so it is the only page whose URL can carry the recovery assertion —
     a signed-out visitor is equally welcome on the public listings a new account lands on. */
  await page.goto('/dashboard');

  // Scripts must not be able to read the refresh token.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('draazyTokens') || '{}'));
  expect(stored.accessToken).toBeTruthy();
  expect(stored.refreshToken).toBeUndefined();

  // `document.cookie` is the exact view an injected payload has, so the name's absence from it is
  // the direct statement of what HttpOnly buys.
  expect(await page.evaluate(() => document.cookie)).not.toContain('draazy_rt');

  /* It does exist — without this, the two absences above are equally consistent with the feature
     being broken. `Path=/` is required by the `__Host-` prefix — see `docs/flows/consumer/auth.md`. */
  const jar = (await context.cookies()).find((c) => c.name === 'draazy_rt');
  expect(jar, 'the refresh cookie was never issued').toBeTruthy();
  expect(jar.httpOnly).toBe(true);
  expect(jar.path).toBe('/');

  /* Tampering, not deletion, is what reaches the 401 recovery, and the signature is *flipped* rather
     than extended — see `docs/flows/consumer/auth.md`. */
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('draazyTokens'));
    const [header, payload, signature] = t.accessToken.split('.');
    const corrupted = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    localStorage.setItem('draazyTokens',
      JSON.stringify({ ...t, accessToken: [header, payload, corrupted].join('.') }));
  });
  const tampered = await page.evaluate(() => JSON.parse(localStorage.getItem('draazyTokens')).accessToken);

  await page.reload();
  /* Poll on *usable and new* as one conjunction — either half alone passes against a real bug, and
     the sentence makes the failure diff say which. See `docs/flows/consumer/auth.md`. */
  await expect
    .poll(async () => {
      const t = await page.evaluate(() => JSON.parse(localStorage.getItem('draazyTokens') || '{}').accessToken);
      if (!t) return 'signed out — the store was cleared instead of renewed';
      if (t === tampered) return 'still the tampered token';
      return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t) ? 'renewed' : 'replaced by something that is not a JWT';
    }, { timeout: 15_000, message: 'the 401 recovery never replaced the access token' })
    .toBe('renewed');
  // Still signed in — not bounced to /signin, which is what a failed refresh looks like.
  await expect(page).toHaveURL(/\/dashboard/);
});

/* Clearing web storage while keeping the cookie jar reproduces Safari's ITP eviction exactly — see
   `docs/flows/consumer/auth.md`. */
test('a session survives web storage being wiped, as it must on Safari after seven days', async ({ page, context }) => {
  const mobile = uniqueMobile();
  await signIn(page, mobile);
  // Guarded route, as in the refresh-token spec: a public page would hold its URL whether or not
  // the session came back.
  await page.goto('/dashboard');

  // The one cookie in the pair deliberately left readable, because the boot path has to see it —
  // `context.cookies()` would report it either way.
  expect(await page.evaluate(() => document.cookie)).toContain('draazy_session');

  // ITP's eviction: everything a script could have written is gone, the jar is untouched.
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  expect(await page.evaluate(() => localStorage.getItem('draazyTokens'))).toBeNull();
  expect((await context.cookies()).find((c) => c.name === 'draazy_rt'),
    'the refresh cookie must outlive the storage wipe — otherwise this proves nothing')
    .toBeTruthy();

  // Cold boot. The hint says a session exists, so the client spends one refresh to recover it.
  await page.reload();
  await expect(page, 'the wiped session was not recovered from the refresh cookie')
    .toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('draazyTokens') || '{}').accessToken),
      { timeout: 15_000, message: 'no access token was minted from the surviving refresh cookie' })
    .toEqual(expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/));

  // Recovery preserves the user's persistent-session choice.
  expect(await page.evaluate(() => localStorage.getItem('draazyTokens')),
    'the recovered session was demoted to the tab-scoped tier').not.toBeNull();
  const rt = (await context.cookies()).find((c) => c.name === 'draazy_rt');
  expect(rt.expires, 'the rotated refresh cookie lost its 30-day lifetime').toBeGreaterThan(0);
});

/* The mirror of the test above, and the dangerous direction: promoting a declined session hands a
   30-day cookie to someone who refused one. See `docs/flows/consumer/auth.md`. */
test('the same rescue does not promote a session the user declined to have remembered', async ({ page, context }) => {
  const mobile = uniqueMobile();
  /* Driven inline because `signIn` always leaves "Remember this device" at its default, which is
     this test's whole subject; the consent seeding is copied from it to keep the bar from
     intercepting the click. */
  await page.addInitScript(() => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({
      necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now(),
    }));
  });
  await page.goto('/signin');
  await page.locator('#signin-mobile').fill(mobile);
  await page.getByRole('button', { name: /send otp|continue/i }).click();

  const boxes = page.locator('#root input[inputmode="numeric"]:not(#signin-mobile)');
  await expect(boxes.first()).toBeVisible();
  await boxes.first().click();
  for (const digit of E2E_OTP) await page.keyboard.type(digit);

  // The one line this test exists for. The box is checked by default, so leaving it alone would
  // silently re-run the test above under a different name.
  await page.getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: /verify|sign in|log in/i }).first().click();
  /* `uniqueMobile()` is a number the server has never seen, so this hand-driven sign-in meets the
     post-OTP name step; nothing about it is this test's subject. */
  await completeProfileIfAsked(page);
  await page.waitForURL('**/listings', { timeout: 20_000 });
  /* The recovery assertion needs a *guarded* route to mean anything, so go to the dashboard
     deliberately; the destination is not the subject here. */
  await page.goto('/dashboard');
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  /* Asserted before the wipe so a failure reads as "login recorded the wrong thing" rather than a
     broken recovery. `expires === -1` is Playwright's spelling of a session cookie. */
  const hint = (await context.cookies()).find((c) => c.name === 'draazy_session');
  expect(hint?.value, 'login recorded the wrong answer to "remember this device"').toBe('0');
  expect(hint.expires, 'an unremembered session was given a persistent marker').toBe(-1);

  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  expect((await context.cookies()).find((c) => c.name === 'draazy_rt'),
    'the refresh cookie must outlive the storage wipe — otherwise this proves nothing')
    .toBeTruthy();

  await page.reload();
  await expect(page, 'the wiped session was not recovered from the refresh cookie')
    .toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect
    .poll(async () => page.evaluate(() => sessionStorage.getItem('draazyTokens')),
      { timeout: 15_000, message: 'no access token was minted from the surviving refresh cookie' })
    .not.toBeNull();

  // Asserted separately because they fail independently: the client decides which tier to write,
  // the server decides the cookie's lifetime.
  expect(await page.evaluate(() => localStorage.getItem('draazyTokens')),
    'the rescue promoted a declined session to the persistent tier').toBeNull();
  expect((await context.cookies()).find((c) => c.name === 'draazy_rt').expires,
    'the rescue traded a session cookie for a 30-day one the user did not ask for').toBe(-1);
});

/* A hint outliving its revoked token turns every cold boot into a refresh that can only 401 — see
   `docs/flows/consumer/auth.md`. */
test('signing out leaves nothing that claims a session', async ({ page, context }) => {
  const mobile = uniqueMobile();
  await signIn(page, mobile);

  // Through the real endpoint because the subject is the pair of Set-Cookie headers the controller
  // emits, and `page.request` shares this context's jar.
  await page.request.post('/api/auth/logout', {
    headers: {
      Authorization: `Bearer ${await page.evaluate(
        () => JSON.parse(localStorage.getItem('draazyTokens')).accessToken)}`,
    },
  });

  const jar = await context.cookies();
  expect(jar.find((c) => c.name === 'draazy_rt'), 'the refresh cookie outlived logout').toBeFalsy();
  expect(jar.find((c) => c.name === 'draazy_session'), 'the session hint outlived logout').toBeFalsy();
});

/* Aborting the request is the only way to reach the swallowed-NetworkError branch — a reachable
   server clears the hint itself. See `docs/flows/consumer/auth.md`. */
test('a sign-out the server never hears about still ends the session here', async ({ page, context }) => {
  const mobile = uniqueMobile();
  await signIn(page, mobile);
  expect((await context.cookies()).find((c) => c.name === 'draazy_session'),
    'no hint to clear — the rest of this test would pass vacuously').toBeTruthy();

  await page.route('**/api/auth/logout', (route) => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Account menu' }).click();
  // The navbar renders the desktop dropdown and the mobile drawer into the same tree, so the label
  // matches twice; only one of them is on screen at this viewport.
  await page.getByRole('button', { name: 'Log out', exact: true }).and(page.locator(':visible')).click();

  await expect
    .poll(async () => (await context.cookies()).some((c) => c.name === 'draazy_session'),
      { timeout: 10_000, message: 'the hint survived a sign-out the server never confirmed' })
    .toBe(false);

  // The proof that matters: the cookie the server never revoked must not be spendable by a boot.
  await page.goto('/');
  await expect(page).toHaveURL(/\/(signin)?$/, { timeout: 15_000 });
  expect(await page.evaluate(() => localStorage.getItem('draazyTokens')),
    'the failed sign-out left a session behind for the next person at this machine').toBeNull();
});

/* The count is the server's, not a local tally, and the wording is read as rendered because the
   server's prose is English-only. See `docs/flows/consumer/auth.md`. */
test('a wrong OTP counts the attempts down and then blocks the form', async ({ page }) => {
  const mobile = uniqueMobile();
  await page.goto('/signin');
  await page.locator('#signin-mobile').fill(mobile);
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();

  const verify = page.getByRole('button', { name: /Verify & Sign In/i });

  // The cap is `draazy.otp.max-verify-attempts` (3). Spend all but the last guess and read the
  // countdown back: 2 left, then 1.
  for (const left of [2, 1]) {
    await fillOtp(page, WRONG_OTP);
    await verify.click();
    await expect(page.locator('#signin-otp-status')).toHaveText(new RegExp(`${left} attempts? left`, 'i'));
  }

  // The third wrong guess burns the code outright, so the message becomes a dead end rather than
  // another countdown.
  await fillOtp(page, WRONG_OTP);
  await verify.click();
  await expect(page.locator('#signin-otp-status')).toHaveText(/too many incorrect attempts/i);
  await expect(verify).toBeDisabled();

  // Typing must not dismiss that: only a fresh code can help, and hiding the blocker on the next
  // keystroke would walk the user straight back into a refusal.
  await page.getByLabel('OTP digit 1').fill('9');
  await expect(page.locator('#signin-otp-status')).toHaveText(/too many incorrect attempts/i);
  await expect(verify).toBeDisabled();

  // Changing identity is a new attempt, not a bypass: discard the spent code and make the person
  // ask for one for the new mobile. Changing back still requires a successful new send.
  await page.locator('#signin-mobile').fill(uniqueMobile());
  await expect(page.getByRole('button', { name: /Send OTP/i })).toBeVisible();
  await expect(verify).toHaveCount(0);
});

/* Sign Up posts to the same `/auth/login` but also raises refusals Sign In cannot, and its catch has
   to tell the two apart — see `docs/flows/consumer/auth.md`. */
test('Sign Up counts the same attempts down and then blocks its own form', async ({ page }) => {
  await page.goto(`/signup?mobile=${uniqueMobile()}&new=1`);
  await page.locator('input[placeholder="Enter your full name"]').fill('Test User');
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();

  const create = page.getByRole('button', { name: /Create Account/i });

  for (const left of [2, 1]) {
    await fillOtp(page, WRONG_OTP);
    await create.click();
    await expect(page.locator('#signup-otp-status')).toHaveText(new RegExp(`${left} attempts? left`, 'i'));
  }

  await fillOtp(page, WRONG_OTP);
  await create.click();
  await expect(page.locator('#signup-otp-status')).toHaveText(/too many incorrect attempts/i);
  await expect(create).toBeDisabled();

  // Same keystroke guard as Sign In: the message survives typing, because typing cannot help.
  await page.getByLabel('OTP digit 1').fill('9');
  await expect(page.locator('#signup-otp-status')).toHaveText(/too many incorrect attempts/i);
  await expect(create).toBeDisabled();
});

test('Staff Login blocks a spent OTP and announces the count', async ({ page }) => {
  await page.goto('/staff-login');
  await page.locator('#staff-mobile').fill(uniqueMobile());
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();

  const verify = page.getByRole('button', { name: /Verify & sign in/i });
  for (const left of [2, 1]) {
    await fillOtp(page, WRONG_OTP);
    await verify.click();
    await expect(page.locator('#staff-otp-status')).toHaveText(new RegExp(`${left} (?:try|tries) left`, 'i'));
  }

  await fillOtp(page, WRONG_OTP);
  await verify.click();
  await expect(page.locator('#staff-otp-status')).toHaveText(/last try.*request a new code/i);
  await expect(verify).toBeDisabled();
});

test('the source mobile is locked while sending an OTP', async ({ page }) => {
  let releaseSend;
  const sendReleased = new Promise((resolve) => { releaseSend = resolve; });
  await page.route('**/api/auth/login', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await sendReleased;
    await route.continue();
  });

  await page.goto('/signin');
  await page.locator('#signin-mobile').fill(uniqueMobile());
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await expect(page.locator('#signin-mobile')).toBeDisabled();

  releaseSend();
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
});

test('an OTP delivery refusal is announced through the form alert', async ({ page }) => {
  await page.route('**/api/auth/login', (route) => route.fulfill({
    status: 429,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'rate_limited', message: 'OTP delivery is temporarily unavailable.', status: 429 }),
  }));

  await page.goto('/signin');
  await page.locator('#signin-mobile').fill(uniqueMobile());
  await page.getByRole('button', { name: /Send OTP/i }).click();

    await expect(page.locator('#signin-otp-status')).toHaveText('OTP delivery is temporarily unavailable.');
  await expect(page.getByLabel('OTP digit 1')).toHaveCount(0);
});

test('a failed OTP resend supersedes a terminal verification message in the form alert', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/auth/login', (route) => {
    requests += 1;
    const responses = [
      // `resendAfterSeconds: 0` is what the e2e profile really answers — its mock sender rings no
      // phone, so the server enforces no cooldown and the resend is allowed immediately.
      { status: 200, body: { otpSent: true, resendAfterSeconds: 0 } },
      { status: 401, body: { error: 'unauthorized', message: 'Incorrect OTP.', status: 401, attemptsRemaining: 0 } },
      { status: 429, body: { error: 'rate_limited', message: 'OTP resend is temporarily unavailable.', status: 429 } },
    ];
    const response = responses[requests - 1];
    return route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });

  await page.goto('/signin');
  await page.locator('#signin-mobile').fill(uniqueMobile());
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await expect(page.getByLabel('OTP digit 1')).toBeVisible();
  await fillOtp(page, WRONG_OTP);
  await page.getByRole('button', { name: /Verify & Sign In/i }).click();
  await expect(page.locator('#signin-otp-status')).toHaveText(/too many incorrect attempts/i);

  const resend = page.getByRole('button', { name: /Resend/i });
  await expect(resend).toHaveText(/Resend OTP/i);
  await expect(resend).toBeEnabled();
  await resend.click();
  await expect(page.locator('#signin-otp-status')).toHaveText('OTP resend is temporarily unavailable.');
});

/* 47s is a value neither side would pick: 30 was the old client constant and 60 the deployed gap, so
   either could pass against the bug. See `docs/flows/consumer/auth.md`. */
test('the resend countdown is the cooldown the server reports, not a constant', async ({ page }) => {
  await page.route('**/api/auth/login', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ otpSent: true, resendAfterSeconds: 47 }),
  }));

  await page.goto('/signin');
  await page.locator('#signin-mobile').fill(uniqueMobile());
  await page.getByRole('button', { name: /Send OTP/i }).click();

  const resend = page.getByRole('button', { name: /Resend/i });
  await expect(resend).toHaveText(/Resend in 4[567]s/);
  await expect(resend).toBeDisabled();
});
