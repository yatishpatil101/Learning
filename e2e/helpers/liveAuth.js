import { expect } from '@playwright/test';

/** Live authentication uses the fixed E2E OTP against the real backend. */
export const E2E_OTP = process.env.E2E_OTP_CODE || '000000';

/** The backend the live suite talks to. Matches `playwright.config.js`'s proxy target. */
export const API = `http://localhost:${process.env.API_PORT || '8081'}/api`;

/**
 * A mobile number no other run will use. The clamp keeps it strictly increasing because
 * `Date.now()` can repeat — see `docs/migration/03-e2e-database-and-users.md`.
 */
let lastIssued = 0;
export function uniqueMobile() {
  const now = Date.now();
  lastIssued = now > lastIssued ? now : lastIssued + 1;
  return `97${String(lastIssued).slice(-8)}`;
}

/**
 * Suppress the DPDPA consent bar, which intercepts clicks on the Verify button.
 * Exported so hand-driven sign-in specs get it too — see `docs/migration/03-e2e-database-and-users.md`.
 */
export const seedConsent = (page) => page.addInitScript(() => {
  localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({
    necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now(),
  }));
});

/** Drive the real two-step sign-in UI as `mobile`; see `docs/migration/03-e2e-database-and-users.md`. */
export async function signIn(page, mobile, { screen = 'consumer', role, next } = {}) {
  const form = SCREENS[screen];
  if (!form) throw new Error(`unknown sign-in screen: ${screen}`);

  await seedConsent(page);

  /* Passed through raw rather than encoded: the only caller testing `next` uses a hostile value,
     and encoding here would be the helper repairing the input under test. */
  await page.goto(next ? `${form.path}?next=${next}` : form.path);

  // The staff console defaults to Administrator, so an ops account must pick its role or the verify
  // silently refuses. Against the live API the picker is absent, hence the count check.
  const wanted = role ?? form.role;
  if (wanted) {
    const picker = page.getByRole('radio', { name: wanted });
    if (await picker.count()) await picker.check();
  }

  await page.locator(form.field).fill(mobile);
  await page.getByRole('button', { name: /send otp|continue/i }).click();

  // The OTP UI is six auto-advancing boxes, so type into the first and let focus move as a user
  // would; the single-input branch keeps this helper unpinned to the component's shape.
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

  await completeProfileIfAsked(page, { away: form.away });

  await expect(page).not.toHaveURL(form.away, { timeout: 20000 });
}

/** Complete the optional profile step without delaying existing named accounts. */
export async function completeProfileIfAsked(page, { away = /\/signin/, name = 'Test Member' } = {}) {
  const profileName = page.locator('#profile-name');
  const landed = await Promise.race([
    page.waitForURL((u) => !away.test(u.toString()), { timeout: 20000 }).then(() => 'away', () => 'timeout'),
    profileName.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'profile', () => 'timeout'),
  ]);
  if (landed !== 'profile') return false;
  await profileName.fill(name);
  await page.getByRole('button', { name: /continue/i }).click();
  return true;
}

const SCREENS = {
  consumer: { path: '/signin', field: '#signin-mobile', away: /signin/ },
  // `role` is the default console for the screen; a spec wanting admin passes `role` explicitly.
  staff: { path: '/staff-login', field: '#staff-mobile', away: /\/staff-login/, role: /Service team/ },
};

/** Keep cached sessions within the access-token TTL to avoid replaying rotated refresh tokens. */
const SESSION_MAX_AGE_MS = 10 * 60 * 1000;

/** Cache sessions per mobile to avoid redundant sign-ins within the safe replay window. */
const sessions = new Map();

export async function signedInAs(page, mobile) {
  const saved = sessions.get(mobile);
  if (saved && Date.now() - saved.at < SESSION_MAX_AGE_MS) {
    // Seed storage before boot so the session marker does not trigger an unnecessary refresh.
    await page.context().addCookies(saved.cookies);
    await page.addInitScript((snapshot) => {
      for (const [k, v] of Object.entries(snapshot.local)) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(snapshot.session)) sessionStorage.setItem(k, v);
    }, { local: saved.local, session: saved.session });
    await page.goto('/');
    return;
  }

  await signIn(page, mobile);
  sessions.set(mobile, {
    at: Date.now(),
    cookies: await page.context().cookies(),
    ...(await page.evaluate(() => ({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    }))),
  });
}

/**
 * Log in over HTTP and return the `AuthResponse`. Setup only, not for assertions; two calls are the
 * contract — see `docs/migration/03-e2e-database-and-users.md`.
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
    // A 403 is the server refusing an account it read, the one failure the backend profile cannot
    // explain — guessing "wrong profile" there sends the reader to restart a healthy backend.
    const hint =
      status === 403
        ? ' - the server read this account and refused it; check `status` in the seed'
        : ' - is the backend running under BOTH the `dev` and `e2e` profiles?';
    throw new Error(`login ${mobile} failed (${status}): ${JSON.stringify(body)}${hint}`);
  }
  return body;
}

/** Convenience for the common shape: the JSON headers a signed-in write needs. */
export async function authHeaders(mobile, opts) {
  const { accessToken } = await apiLogin(mobile, opts);
  return { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };
}

/**
 * Sign in as a brand-new account and return its mobile. Its display name is always `Test Member`,
 * so never assert on it — see `docs/migration/03-e2e-database-and-users.md`.
 */
export async function signedInAsNew(page, { api = API } = {}) {
  const mobile = uniqueMobile();
  await apiLogin(mobile, { api });
  await signedInAs(page, mobile);
  return mobile;
}

/** Grant a new test account the local-only Aadhaar badge through the callback service. */
export async function grantAadhaarBadge(mobile, { api = API } = {}) {
  const res = await fetch(`${api}/me/verification/aadhaar/simulate`, {
    method: 'POST',
    headers: await authHeaders(mobile, { api }),
  });
  if (!res.ok) {
    throw new Error(
      `simulate badge failed for ${mobile}: ${res.status} ${await res.text()} — `
      + 'is the backend running under the `local` profile? The endpoint is @LocalOnly.',
    );
  }
  return res.json();
}

/** Forget cached sessions, for a spec that must prove a *fresh* login works. */
export function forgetSessions() {
  sessions.clear();
}
