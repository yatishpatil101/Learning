import { expect } from '@playwright/test';

// Live authentication uses the fixed E2E OTP against the real backend.
export const E2E_OTP = process.env.E2E_OTP_CODE || '000000';
const SEND_OTP_CTA = /send otp|continue|otp पाठवा|otp भेजें/i;
const VERIFY_CTA = /verify|sign in|log in|continue|पडताळा|सत्यापित/i;

// The backend the live suite talks to.
export const API = `http://localhost:${process.env.API_PORT || '8081'}/api`;

// Seeded by db/seed-staff/R__zz_DML_dev_staff_credentials.sql for every back-office account.
export const STAFF_PASSWORD = 'Draazy-dev-pass1';
export const E2E_STAFF_CODE = process.env.E2E_STAFF_TOTP_CODE || '000000';
export const staffEmail = (mobile) => `${mobile}@staff.draazy.test`;

// A mobile no other run will use; the clamp keeps it increasing because `Date.now()` can repeat.
let lastIssued = 0;
export function uniqueMobile() {
  const now = Date.now();
  lastIssued = now > lastIssued ? now : lastIssued + 1;
  return `97${String(lastIssued).slice(-8)}`;
}

export const storedPhotoUrl = (hash = '', ownerId = crypto.randomUUID()) =>
  `/api/dev/storage/public/photos/${ownerId}/${crypto.randomUUID()}${hash ? `-${hash}` : ''}`;

export function ownerIdOf(auth) {
  const raw = typeof auth === 'string' ? auth
    : auth?.accessToken ?? auth?.authorization ?? auth?.Authorization ?? '';
  const token = raw.replace(/^Bearer\s+/i, '');
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
}

const LISTING_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4AWJiYGD4D8IgBpBmYAAAAAD//7vS9wEAAAAGSURBVAMAGDACA6ybwrYAAAAASUVORK5CYII=',
  'base64',
);

export async function uploadedListingPhotos(auth, count = 1, { api = API } = {}) {
  const raw = typeof auth === 'string' ? auth : auth?.accessToken ?? auth?.authorization ?? auth?.Authorization ?? '';
  const authorization = /^Bearer\s/i.test(raw) ? raw : `Bearer ${raw}`;
  const urls = [];
  for (let i = 0; i < count; i += 1) {
    const form = new FormData();
    form.set('file', new Blob([LISTING_PNG], { type: 'image/png' }), `listing-${i}.png`);
    const res = await fetch(`${api}/me/photos`, { method: 'POST', headers: { authorization }, body: form });
    if (res.status !== 201) throw new Error(`POST /me/photos failed: ${res.status} ${await res.text()}`);
    urls.push((await res.json()).url);
  }
  return urls;
}

export const seedConsent = (page) => page.addInitScript(() => {
  localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({
    necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now(),
  }));
});

export async function signIn(page, mobile, { screen = 'consumer', next, search, settleAtHome = false } = {}) {
  const form = SCREENS[screen];
  if (!form) throw new Error(`unknown sign-in screen: ${screen}`);

  await seedConsent(page);

  const query = [next && `next=${next}`, search].filter(Boolean).join('&');
  await page.goto(query ? `${form.path}?${query}` : form.path);

  if (screen === 'staff') {
    await staffSignInUi(page, mobile);
    await expect(page).not.toHaveURL(form.away, { timeout: 20000 });
    return;
  }

  await page.locator(form.field).fill(mobile);
  await page.getByRole('button', { name: SEND_OTP_CTA }).click();

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

  const verify = page.getByRole('button', { name: VERIFY_CTA });
  if (await verify.count()) await verify.first().click();

  await completeProfileIfAsked(page, { away: form.away });

  if (settleAtHome && form.away.test(page.url())) {
    const signedIn = await page.evaluate(() => {
      try {
        return Boolean(JSON.parse(localStorage.getItem('draazyTokens') || '{}').accessToken);
      } catch {
        return false;
      }
    });
    if (signedIn) {
      await page.goto('/');
      return;
    }
  }

  await expect(page).not.toHaveURL(form.away, { timeout: 20000 });
}

// Complete the optional profile step without delaying existing named accounts.
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

// Password, then the code; a first sign-in also confirms enrolment and dismisses the recovery codes.
export async function staffSignInUi(page, mobile) {
  await page.locator('#staff-email').fill(staffEmail(mobile));
  await page.locator('#staff-password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#staff-code').fill(E2E_STAFF_CODE);
  await page.getByRole('button', { name: /^(Sign in|Confirm & sign in)$/ }).click();
  const codes = page.locator('#staff-recovery-codes');
  const landed = await Promise.race([
    codes.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'codes', () => 'timeout'),
    page.waitForURL((u) => !/\/staff-login/.test(u.toString()), { timeout: 20000 }).then(() => 'away', () => 'timeout'),
  ]);
  if (landed === 'codes') await page.getByRole('button', { name: /continue/i }).click();
}

const SCREENS = {
  consumer: { path: '/signin', field: '#signin-mobile', away: /signin/ },
  staff: { path: '/staff-login', away: /\/staff-login/ },
};

// Keep cached sessions within the access-token TTL to avoid replaying rotated refresh tokens.
const SESSION_MAX_AGE_MS = 10 * 60 * 1000;

// Cache sessions per mobile to avoid redundant sign-ins within the safe replay window.
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

  await signIn(page, mobile, { settleAtHome: true });
  sessions.set(mobile, {
    at: Date.now(),
    cookies: await page.context().cookies(),
    ...(await page.evaluate(() => ({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    }))),
  });
}

// Two calls are the contract: the first issues the OTP, the second redeems it. Back-office accounts
// are refused there, so they take the password + authenticator route instead.
export async function apiLogin(mobile, { api = API } = {}) {
  const send = async (path, body) => {
    const res = await fetch(`${api}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  await send('/auth/login', { mobile });
  let { status, body } = await send('/auth/login', { mobile, otp: E2E_OTP });
  if (status === 403 && body.error === 'staff_sign_in_required') {
    ({ status, body } = await apiStaffLogin(mobile, send));
  }
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

async function apiStaffLogin(mobile, send) {
  const step = await send('/auth/staff-login', { email: staffEmail(mobile), password: STAFF_PASSWORD });
  if (step.status !== 200) return step;
  const { mfa, challenge } = step.body;
  if (mfa === 'enrol') {
    const enrol = await send('/auth/staff-login/enrol', { challenge });
    if (enrol.status !== 200) return enrol;
    return send('/auth/staff-login/enrol/confirm', { challenge, code: E2E_STAFF_CODE });
  }
  return send('/auth/staff-login/verify', { challenge, code: E2E_STAFF_CODE });
}

export async function authHeaders(mobile, opts) {
  const { accessToken } = await apiLogin(mobile, opts);
  return { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };
}

export async function identityChallengeToken(authorization, { api = API } = {}) {
  const res = await fetch(`${api}/me/verification/identity/challenge`, {
    method: 'POST',
    headers: { authorization },
  });
  if (!res.ok) throw new Error(`identity challenge failed: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

// The new account's display name is always `Test Member`, so never assert on it.
export async function signedInAsNew(page, { api = API } = {}) {
  const mobile = uniqueMobile();
  const session = await apiLogin(mobile, { api });
  const profile = await fetch(`${api}/auth/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ name: 'Test Member' }),
  });
  if (!profile.ok) throw new Error(`naming ${mobile} failed (${profile.status}): ${await profile.text()}`);
  const user = await profile.json();
  await page.addInitScript(({ accessToken, user: signedInUser }) => {
    localStorage.setItem('draazyTokens', JSON.stringify({ accessToken }));
    localStorage.setItem('draazyUser', JSON.stringify(signedInUser));
  }, { accessToken: session.accessToken, user });
  await page.goto('/');
  return mobile;
}

// Simulation decides an existing case, so a badge first needs a real queued multipart claim.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// Two calls: the simulate endpoint 404s on an account with no pending case, so file one first.
export async function grantIdentityBadge(mobile, { api = API } = {}) {
  const { authorization } = await authHeaders(mobile, { api });

  const form = new FormData();
  form.set('docType', 'pan');
  form.set('consent', 'true');
  form.set('challenge', await identityChallengeToken(authorization, { api }));
  form.set('front', new Blob([TINY_PNG], { type: 'image/png' }), 'front.png');
  form.set('selfie', new Blob([TINY_PNG], { type: 'image/png' }), 'selfie.png');
  const filed = await fetch(`${api}/me/verification/identity`, {
    method: 'POST',
    headers: { authorization },
    body: form,
  });
  if (!filed.ok) {
    throw new Error(`filing an identity case failed for ${mobile}: ${filed.status} ${await filed.text()}`);
  }

  const res = await fetch(`${api}/me/verification/identity/simulate`, {
    method: 'POST',
    headers: { authorization },
  });
  if (!res.ok) {
    throw new Error(
      `simulate badge failed for ${mobile}: ${res.status} ${await res.text()} — `
      + 'is the backend running under the `local` profile? The endpoint is @LocalOnly.',
    );
  }
  return res.json();
}

// Forget cached sessions, for a spec that must prove a *fresh* login works.
export function forgetSessions() {
  sessions.clear();
}
