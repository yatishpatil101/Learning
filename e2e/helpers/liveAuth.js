import { expect } from '@playwright/test';

/**
 * Sign-in against a **real backend**, for the `live-*.spec.js` suite only.
 *
 * Deliberately separate from `auth.js`, which seeds `localStorage` for the mock suite. Those two
 * suites have opposite requirements - the mock one must pass with no backend and no Postgres, and
 * this one must exercise the genuine JWT path - so one helper serving both would have to branch on
 * a mode flag at every step, and the branch nobody runs is the branch that rots. `auth.js` is left
 * exactly as it is; when Phase 5 retires the mock provider, it retires with it.
 *
 * ## Why the OTP is no longer scraped from the log
 *
 * Reading `[MOCK OTP] mobile=... code=...` out of the backend's console worked, and it cost the
 * suite two things. It needed `BACKEND_LOG` to name the log of the backend you actually started -
 * point it at a stale file and the symptom is a timeout on the OTP screen, which reads as a product
 * bug. And one shared log cannot tell two concurrent logins whose code is whose, which is why the
 * live config pins `workers: 1`.
 *
 * Under the `e2e` profile the code is fixed (`punenest.otp.fixed-code`, see `OtpService`), so this
 * helper types a constant. Everything else about the flow is unchanged and still real: the code is
 * generated, hashed, stored, single-use, and expiring; a wrong code is still refused. See
 * `docs/migration/03-e2e-database-and-users.md`.
 *
 * ## Create-or-reuse, and why it needs no branch
 *
 * `POST /auth/login` registers an unknown mobile on first successful verification, so "create the
 * user" and "log the user in" are the same call. A spec can therefore name any number - a seeded
 * fixture from `docs/system/fixture-registry.md`, or one it invents with {@link uniqueMobile} - and
 * get a session either way. Nothing here inspects the database.
 */
export const E2E_OTP = process.env.E2E_OTP_CODE || '000000';

/** The backend the live suite talks to. Matches `playwright.live.config.js`'s proxy target. */
export const API = `http://localhost:${process.env.API_PORT || '8081'}/api`;

/**
 * A mobile number no other run will use.
 *
 * For specs that must not collide with each other or with a previous run - registration,
 * onboarding, anything asserting "this is a new account". The seeded fixtures stay reserved for
 * read-only assertions, which is the drift rule from the phase doc: mutating specs create their own
 * data rather than editing a fixture other specs are asserting against.
 *
 * `97` prefix keeps it inside the seed's reserved block and away from real Indian numbering; the
 * timestamp tail is what makes it unique.
 */
export function uniqueMobile() {
  return `97${String(Date.now()).slice(-8)}`;
}

/**
 * Complete the two-step sign-in UI as `mobile` and land wherever the app sends the user.
 *
 * Drives the real form rather than posting to the API: the point of a browser test is that the
 * screens work, and a helper that skipped them would leave the OTP component untested by every spec
 * that uses it. Use {@link apiLogin} instead when a session is only *setup* for the screen you
 * actually mean to test.
 *
 * `screen` selects the form. Consumers and staff sign in on different routes with different field
 * ids but the identical OTP component, so this is one function with a two-entry table rather than
 * two near-copies that will drift.
 */
export async function signIn(page, mobile, { screen = 'consumer', role } = {}) {
  const form = SCREENS[screen];
  if (!form) throw new Error(`unknown sign-in screen: ${screen}`);

  await page.goto(form.path);

  // The internal console asks *which* console before it asks who you are, and it defaults to
  // Administrator. A service-team account that leaves the default alone is asking for a console it
  // has no claim to, so the verify silently refuses and the page just sits on /staff-login with no
  // error worth reading. Choosing the role explicitly is what makes an ops sign-in work at all.
  //
  // Against the live API the picker is not rendered at all: `/auth/login` returns the account's own
  // role and team, so there is nothing for the browser to choose. Hence the count check rather than
  // a bare `.check()` — this helper drives both builds.
  const wanted = role ?? form.role;
  if (wanted) {
    const picker = page.getByRole('radio', { name: wanted });
    if (await picker.count()) await picker.check();
  }

  await page.locator(form.field).fill(mobile);
  await page.getByRole('button', { name: /send otp|continue/i }).click();

  // The OTP UI is six single-character boxes that auto-advance, not one field. Type into the first
  // and let the component move focus - which is also what a real user does, and is the behaviour
  // worth exercising. The single-input branch is kept because the component's shape is a UI detail
  // this helper should not be pinned to.
  const boxes = page.locator(`#root input[inputmode="numeric"]:not(${form.field})`);
  await expect(boxes.first()).toBeVisible();
  if ((await boxes.count()) > 1) {
    await boxes.first().click();
    for (const digit of E2E_OTP) await page.keyboard.type(digit);
  } else {
    await boxes.first().fill(E2E_OTP);
  }

  const verify = page.getByRole('button', { name: /verify|sign in|log in|continue/i });
  if (await verify.count()) await verify.first().click();
  await expect(page).not.toHaveURL(form.away, { timeout: 20000 });
}

const SCREENS = {
  consumer: { path: '/signin', field: '#signin-mobile', away: /signin/ },
  // `role` is the default console for the screen. Staff sign-ins mean the ops portal far more often
  // than they mean admin, and an admin spec can still say so with `{ screen: 'staff', role: /Administrator/ }`.
  staff: { path: '/staff-login', field: '#staff-mobile', away: /\/staff-login/, role: /Service team/ },
};

/**
 * Sign in once per mobile per run, then replay the stored session into later pages.
 *
 * Still worth having even though the send cooldown is 0 under the `e2e` profile: a sign-in is a
 * page load, a form, a round trip and a redirect, and a file with a dozen tests pays that a dozen
 * times for a session it already has. The cooldown is why this *had* to exist; speed is why it
 * stays.
 *
 * Both storage areas are captured because "remember me" decides which one `lib/auth.js` writes to,
 * and no spec should depend on that choice.
 */
const sessions = new Map();

export async function signedInAs(page, mobile) {
  if (sessions.has(mobile)) {
    // Storage is origin-scoped, so a document from the origin must exist before writing to it.
    await page.goto('/');
    await page.evaluate((saved) => {
      for (const [k, v] of Object.entries(saved.local)) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(saved.session)) sessionStorage.setItem(k, v);
    }, sessions.get(mobile));
    await page.goto('/');
    return;
  }

  await signIn(page, mobile);
  sessions.set(
    mobile,
    await page.evaluate(() => ({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    })),
  );
}

/**
 * Log in over HTTP, no browser, and return the `AuthResponse` (`user`, `accessToken`,
 * `refreshToken`).
 *
 * For **setup**, not for assertions. A spec that needs a row to exist before it can test a screen -
 * a service request with identities on it, say - should create it the cheap way and spend its
 * browser time on the screen under test. Driving a wizard to produce fixture data tests the wizard.
 *
 * Two calls because that is the contract: `POST /auth/login` with just a mobile sends a code and
 * answers `{ otpSent: true }`; the same endpoint with `otp` verifies it and returns the session.
 * There is no separate `/auth/verify`.
 */
export async function apiLogin(mobile, { api = API } = {}) {
  const send = async (body) => {
    const res = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  await send({ mobile });
  const { status, body } = await send({ mobile, otp: E2E_OTP });
  if (status !== 200) {
    // Naming the likely cause here saves the next person the hour it costs to work out that a
    // backend on the wrong profile looks identical to a wrong code.
    throw new Error(
      `login ${mobile} failed (${status}): ${JSON.stringify(body)} - is the backend running ` +
        'under BOTH the `dev` and `e2e` profiles?',
    );
  }
  return body;
}

/**
 * Convenience for the common shape: the JSON headers a signed-in write needs.
 */
export async function authHeaders(mobile, opts) {
  const { accessToken } = await apiLogin(mobile, opts);
  return { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };
}

/**
 * Sign in as a brand-new account and return its mobile.
 *
 * For specs whose subject is a *state transition* on the account itself — getting verified,
 * completing onboarding, first-run empty states. Those cannot use the seeded actors: the fixture
 * registry publishes their state as an invariant (Arjun is unverified, Rahul has exactly 2 saved),
 * and a spec that flips one is not testing a transition so much as breaking the next spec's
 * premise, on a database that persists for the whole run.
 *
 * The registration happens over HTTP because the UI cannot do it in one step: `/signin` bounces an
 * unknown number to `/signup`. `POST /auth/login` auto-registers an unknown mobile as a buyer, so
 * one round trip creates the account and the browser sign-in that follows is then an ordinary one.
 * The extra call also means the returned session is a real one rather than an injected token.
 */
export async function signedInAsNew(page, { api = API } = {}) {
  const mobile = uniqueMobile();
  await apiLogin(mobile, { api });
  await signedInAs(page, mobile);
  return mobile;
}

/**
 * Grant `mobile` the Aadhaar badge, the way a real DigiLocker callback would.
 *
 * Drives `POST /me/verification/aadhaar/simulate`, the `@DevOnly` endpoint that exists precisely
 * because a dev backend never receives the provider webhook that is the only real grant path
 * (D122). It is not a shortcut around the domain logic: the controller calls
 * `VerificationService.simulateSuccess`, which runs the same `handleWebhook` code a signed callback
 * would, so one-Aadhaar-one-account dedup and idempotency still apply — a spec that used it to
 * verify two accounts with one identity would still get the real refusal.
 *
 * Use it on an account minted by `signedInAsNew`, never on a seeded actor: verification state is a
 * published invariant in `docs/system/fixture-registry.md`, and this is a one-way flip on a database
 * that lives for the whole run.
 *
 * The call goes over HTTP rather than through the UI because there is no UI for it — that is the
 * whole point of the endpoint. Reload the page afterwards to see the badge.
 */
export async function grantAadhaarBadge(mobile, { api = API } = {}) {
  const res = await fetch(`${api}/me/verification/aadhaar/simulate`, {
    method: 'POST',
    headers: await authHeaders(mobile, { api }),
  });
  if (!res.ok) {
    throw new Error(
      `simulate badge failed for ${mobile}: ${res.status} ${await res.text()} — `
      + 'is the backend running under the `dev` profile? The endpoint is @DevOnly.',
    );
  }
  return res.json();
}

/**
 * Forget cached sessions.
 *
 * The cache is per Node process, so it already dies with the run; this exists for a spec that wants
 * to prove a *fresh* login works - re-authenticating after a password change, say - where replaying
 * the old session would assert nothing.
 */
export function forgetSessions() {
  sessions.clear();
}
