import { test, expect } from '../../../fixtures/live.js';
import { E2E_OTP, apiLogin, signIn, uniqueMobile } from '../../../helpers/liveAuth.js';

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

/* The refresh token is out of JavaScript's reach, and the session still renews itself.
 *
 * Both halves are here because either alone is worthless. Hiding the token is easy if you are
 * willing to break renewal, and renewal is easy if you leave the token where any XSS payload can
 * read it; the claim worth pinning is that we did both. And this is the only level at which the
 * claim can be tested at all — MockMvc has no cookie jar, no `document.cookie`, and no same-origin
 * policy, so a backend test can prove the `HttpOnly` *attribute* was set but not that a browser
 * honours it or that the client's `credentials: 'include'` actually sends it back. */
test('the refresh token is unreadable by scripts, and the session renews anyway', async ({ page, context }) => {
  const mobile = uniqueMobile();
  await signIn(page, mobile);
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  // 1. It is not in localStorage. This is the regression that matters: the token used to be stored
  //    beside the access token under the same key, and putting it back would be a one-line change
  //    nothing else would notice.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestTokens') || '{}'));
  expect(stored.accessToken).toBeTruthy();
  expect(stored.refreshToken).toBeUndefined();

  // 2. Nor anywhere else a script can see. `document.cookie` is the exact view an injected payload
  //    has, so asserting the name is absent from it is the direct statement of what HttpOnly buys.
  expect(await page.evaluate(() => document.cookie)).not.toContain('punenest_rt');

  // 3. It does exist — read through the browser's own jar, which scripts cannot reach. Without this
  //    the two absences above are equally consistent with "no refresh token was ever issued", i.e.
  //    with the feature being broken rather than secured.
  //
  //    `Path=/` is deliberate, and it is the *narrower* `/api/auth` that was given up. Path scoping
  //    only defended against our own code forwarding or logging a request that carried the cookie,
  //    and nothing in the backend logs cookies. `Path=/` is a hard requirement of the `__Host-`
  //    prefix production uses, which is what stops another host under the registrable domain
  //    planting a same-named `Domain=` cookie the browser might hand over instead of ours — an
  //    attack no page-level attribute can prevent, and one the cold-boot restore would carry out
  //    automatically. The name is asked of the server rather than hardcoded because this harness
  //    runs over plain HTTP, where a browser rejects the prefix outright.
  const jar = (await context.cookies()).find((c) => c.name === 'punenest_rt');
  expect(jar, 'the refresh cookie was never issued').toBeTruthy();
  expect(jar.httpOnly).toBe(true);
  expect(jar.path).toBe('/');

  /* 4. And it works. Corrupting the access token makes the next authenticated call 401, which is
   *    the branch `services/http.js` recovers from: it posts `/auth/refresh` with no credential in
   *    the body at all, the browser attaches the cookie because of `credentials: 'include'`, and
   *    the retry succeeds. Tampering is the honest way to reach this — the token is valid for
   *    fifteen minutes and no spec should sit and wait for that, while simply deleting it would
   *    exercise a different path (the recovery gate treats an absent access token as "not signed
   *    in" and never attempts a refresh). The user stays signed in throughout, so what is asserted
   *    afterwards is a *different* access token under an unbroken session.
   *
   *    The signature is corrupted by **flipping** its first character, not by appending one. An
   *    HS384 signature is 48 bytes, i.e. exactly 64 base64url characters with no padding and no
   *    spare bits, so a 65th character decodes to nothing and is discarded — the token verifies
   *    happily and the whole test passes while proving nothing. That is what the first run of this
   *    spec did: every request after the "tamper" came back 200. */
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('puneNestTokens'));
    const [header, payload, signature] = t.accessToken.split('.');
    const corrupted = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    localStorage.setItem('puneNestTokens',
      JSON.stringify({ ...t, accessToken: [header, payload, corrupted].join('.') }));
  });
  const tampered = await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestTokens')).accessToken);

  await page.reload();
  // Poll for a token that is both *usable* and *new*. Either half alone is a bug that has already
  // been hit here. `.not.toBe(tampered)` alone also passes when the store has been cleared —
  // `undefined !== tampered` — so a sign-out satisfied the very assertion meant to prove renewal,
  // and the failure surfaced one line later as a URL mismatch, reading like a routing bug. But
  // "is a JWT" alone is worse, because the tampered token is still perfectly JWT-shaped (only its
  // signature was flipped): that poll passed on its first evaluation, before the recovery had even
  // sent `/auth/refresh`, so the test was really a race between `reload()` resolving and a
  // 401-plus-refresh round trip. It won that race for a long time and lost it the moment an
  // unrelated change shifted boot timing by a few milliseconds. Polling on the conjunction removes
  // the race: the only value that satisfies it is one the refresh actually produced.
  //
  // Reported as a sentence rather than a token so the diff on failure says which of the three ways
  // this can go wrong actually happened.
  await expect
    .poll(async () => {
      const t = await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestTokens') || '{}').accessToken);
      if (!t) return 'signed out — the store was cleared instead of renewed';
      if (t === tampered) return 'still the tampered token';
      return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t) ? 'renewed' : 'replaced by something that is not a JWT';
    }, { timeout: 15_000, message: 'the 401 recovery never replaced the access token' })
    .toBe('renewed');
  // Still signed in — not bounced to /signin, which is what a failed refresh looks like.
  await expect(page).toHaveURL(/\/dashboard/);
});

/* "Remember this device for 30 days" survives a browser that wipes web storage.
 *
 * Safari's ITP deletes script-writable storage — localStorage, IndexedDB, `document.cookie` writes
 * — after seven days without first-party interaction, while leaving server-set cookies alone. So on
 * day eight a remembered user has no cached profile and no access token, and a perfectly good
 * refresh cookie with three more weeks on it. Before the session-hint cookie, nothing spent that
 * cookie: an absent access token reads as "signed out" everywhere else in the client, deliberately,
 * because for an ordinary request that is exactly what it means. The result was a forced sign-in at
 * seven days and a stranded credential — a promise of 30 days that quietly meant a quarter of that.
 *
 * Clearing web storage while keeping the cookie jar *is* the ITP eviction, faithfully: Playwright
 * has no way to run Safari's seven-day timer, but the state it leaves behind is reproducible
 * exactly, and that state is the whole input to the code under test. This only works at the browser
 * level — MockMvc has neither a cookie jar nor a `localStorage` to be robbed of. */
test('a session survives web storage being wiped, as it must on Safari after seven days', async ({ page, context }) => {
  const mobile = uniqueMobile();
  await signIn(page, mobile);
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  // The marker has to be readable, or the boot path cannot see it. This is the one cookie in the
  // pair that is deliberately *not* HttpOnly, and asserting it from a script is the direct
  // statement of that — `context.cookies()` would report it either way.
  expect(await page.evaluate(() => document.cookie)).toContain('punenest_session');

  // ITP's eviction: everything a script could have written is gone, the jar is untouched.
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  expect(await page.evaluate(() => localStorage.getItem('puneNestTokens'))).toBeNull();
  expect((await context.cookies()).find((c) => c.name === 'punenest_rt'),
    'the refresh cookie must outlive the storage wipe — otherwise this proves nothing')
    .toBeTruthy();

  // Cold boot. The hint says a session exists, so the client spends one refresh to recover it.
  await page.reload();
  await expect(page, 'the wiped session was not recovered from the refresh cookie')
    .toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('puneNestTokens') || '{}').accessToken),
      { timeout: 15_000, message: 'no access token was minted from the surviving refresh cookie' })
    .toEqual(expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/));

  /* And the rescue must not spend the thing it rescued. `remember` is restated on every rotation
   * because the browser tells the server nothing about the lifetime of the cookie it presents, and
   * the client used to derive that flag from *which storage tier held the tokens* — a derivation
   * this very wipe destroys. Left alone, the recovering refresh would report "not remembered",
   * take a session-scoped cookie in exchange for the 30-day one, and write its tokens to
   * `sessionStorage`: the user would be signed in until they closed the tab, having asked to be
   * remembered for a month. That is a strictly worse outcome than the bug this test exists for,
   * because it is silent and it destroys a credential that was still good. Hence the two
   * assertions below — the persistent tier, and a cookie with an expiry rather than a session
   * cookie (`expires === -1` is Playwright's spelling of "dies with the browser"). */
  expect(await page.evaluate(() => localStorage.getItem('puneNestTokens')),
    'the recovered session was demoted to the tab-scoped tier').not.toBeNull();
  const rt = (await context.cookies()).find((c) => c.name === 'punenest_rt');
  expect(rt.expires, 'the rotated refresh cookie lost its 30-day lifetime').toBeGreaterThan(0);
});

/* The same rescue for a user who declined to be remembered, which is where it can do harm.
 *
 * The test above proves the recovery does not *demote* a remembered session. This one proves the
 * mirror, and the mirror is the dangerous direction: a rescue that promotes an unremembered session
 * hands a 30-day cookie to someone who explicitly asked for one that dies with the browser, and it
 * does so on a shared machine, silently, while every screen still reads "signed in". Nobody would
 * see it until the next person opened the laptop.
 *
 * The pair is the point. `remember` is restated by the client on every rotation, from one value, so
 * a single wrong read moves BOTH cases — and each alone passes for either of the two readings that
 * matter. Assert only the remembered case and "always send true" is green. Assert only this one and
 * "always send false" is green. Together they pin the flag to the user's actual choice, which is
 * the only thing the server has to go on.
 *
 * Note that the storage wipe here is not Safari's seven-day eviction — an unremembered session is
 * gone long before day seven, because the browser drops both the tokens and the refresh cookie when
 * it closes. What is reproduced is any mid-session loss of web storage with the jar intact (a
 * "clear site data" for storage only, a strict-mode eviction, a private window under pressure), and
 * the recovery path it lands in is the same one, reading the same marker. */
test('the same rescue does not promote a session the user declined to have remembered', async ({ page, context }) => {
  const mobile = uniqueMobile();
  /* Driven inline rather than through `signIn`, and this is the only reason: the helper always
     leaves "Remember this device" at its default, and the whole subject of this test is the other
     value. The consent seeding is copied from it deliberately — the DPDPA bar mounts over the last
     control on the form and Playwright will not click through an intercepting element, so without
     this the test's outcome depends on whether the banner mounted before the click. */
  await page.addInitScript(() => {
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({
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
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  /* The marker's *value* is what carries the choice, and it is asserted before the wipe so that a
   * failure here is legible as "login recorded the wrong thing" rather than as a broken recovery.
   * `expires === -1` is Playwright's spelling of a session cookie: the marker is scoped exactly
   * like the token it describes, so it cannot outlive it and claim a session that is gone. */
  const hint = (await context.cookies()).find((c) => c.name === 'punenest_session');
  expect(hint?.value, 'login recorded the wrong answer to "remember this device"').toBe('0');
  expect(hint.expires, 'an unremembered session was given a persistent marker').toBe(-1);

  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  expect((await context.cookies()).find((c) => c.name === 'punenest_rt'),
    'the refresh cookie must outlive the storage wipe — otherwise this proves nothing')
    .toBeTruthy();

  await page.reload();
  await expect(page, 'the wiped session was not recovered from the refresh cookie')
    .toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect
    .poll(async () => page.evaluate(() => sessionStorage.getItem('puneNestTokens')),
      { timeout: 15_000, message: 'no access token was minted from the surviving refresh cookie' })
    .not.toBeNull();

  // The two halves of the promotion, asserted separately because they fail independently: the
  // client decides which tier to write, the server decides the cookie's lifetime, and they agree
  // only because the client restated the flag correctly on the way past.
  expect(await page.evaluate(() => localStorage.getItem('puneNestTokens')),
    'the rescue promoted a declined session to the persistent tier').toBeNull();
  expect((await context.cookies()).find((c) => c.name === 'punenest_rt').expires,
    'the rescue traded a session cookie for a 30-day one the user did not ask for').toBe(-1);
});

/* The other half of the same contract, and the reason the marker is a cookie the server clears
 * rather than a flag the client sets: after a deliberate sign-out there must be nothing left
 * claiming a session. A hint that outlived its revoked token would send every subsequent cold boot
 * into a refresh that can only 401 — turning a clean logout into a request shaped exactly like
 * reuse-detection tripping, on a path where that is the one thing we watch for. */
test('signing out leaves nothing that claims a session', async ({ page, context }) => {
  const mobile = uniqueMobile();
  await signIn(page, mobile);
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  // Through the real endpoint rather than a UI affordance, because what is under test is the pair
  // of Set-Cookie headers the controller emits, and `page.request` shares this context's jar.
  await page.request.post('/api/auth/logout', {
    headers: {
      Authorization: `Bearer ${await page.evaluate(
        () => JSON.parse(localStorage.getItem('puneNestTokens')).accessToken)}`,
    },
  });

  const jar = await context.cookies();
  expect(jar.find((c) => c.name === 'punenest_rt'), 'the refresh cookie outlived logout').toBeFalsy();
  expect(jar.find((c) => c.name === 'punenest_session'), 'the session hint outlived logout').toBeFalsy();
});

/* The sign-out that does not reach the server, which is the case the hint made dangerous.
 *
 * `authProvider.logout` posts best-effort and swallows a NetworkError, on the reasoning that the
 * residue is unreachable anyway: the refresh cookie is HttpOnly and nothing in the app could refresh
 * without an access token. The recovery path above is exactly such a thing, so that reasoning
 * expired the day it was written — a hint left in the jar beside an unrevoked cookie means the next
 * launch signs the user back in. On a shared machine, into the account of whoever pressed sign-out.
 *
 * The abort is the whole test: it reproduces a tap on a train, in a lift, behind a captive portal,
 * and it is the only way to reach the branch, since a reachable server clears the hint itself and
 * the assertion would pass for the wrong reason. */
test('a sign-out the server never hears about still ends the session here', async ({ page, context }) => {
  const mobile = uniqueMobile();
  await signIn(page, mobile);
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  expect((await context.cookies()).find((c) => c.name === 'punenest_session'),
    'no hint to clear — the rest of this test would pass vacuously').toBeTruthy();

  await page.route('**/api/auth/logout', (route) => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Account menu' }).click();
  // The navbar renders the desktop dropdown and the mobile drawer into the same tree, so the label
  // matches twice; only one of them is on screen at this viewport.
  await page.getByRole('button', { name: 'Log out', exact: true }).and(page.locator(':visible')).click();

  await expect
    .poll(async () => (await context.cookies()).some((c) => c.name === 'punenest_session'),
      { timeout: 10_000, message: 'the hint survived a sign-out the server never confirmed' })
    .toBe(false);

  // The proof that matters: the cookie the server never revoked must not be spendable by a boot.
  await page.goto('/');
  await expect(page).toHaveURL(/\/(signin)?$/, { timeout: 15_000 });
  expect(await page.evaluate(() => localStorage.getItem('puneNestTokens')),
    'the failed sign-out left a session behind for the next person at this machine').toBeNull();
});
