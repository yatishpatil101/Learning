/**
 * HTTP auth provider, behind the `authService.js` seam. Login is **two round-trips** (send OTP,
 * then verify), which is why `sendOtp` is its own method rather than a parameter of `login`.
 */
import { get, patch, persistTokens, post, unwrapPage } from '../../http.js';
import { logoutUser, sessionRemembered, writeUser } from '../../../lib/auth.js';

/**
 * Step 1: ask the server to dispatch a login code — the step that spends an SMS.
 * `resendAfterSeconds` and the header-borne turnstile token: docs/flows/consumer/auth.md
 */
export const sendOtp = ({ mobile, turnstileToken }) => post(
  '/auth/login',
  { mobile },
  { auth: false, headers: turnstileToken ? { 'CF-Turnstile-Response': turnstileToken } : undefined },
);

/**
 * Step 2: verify the code and open a session; first-time mobiles are provisioned server-side.
 * `remember` goes on the wire too — only the server can scope the refresh cookie to match.
 */
export async function login({ mobile, otp, remember = true }) {
  const data = await post('/auth/login', { mobile, otp, remember }, { auth: false });
  return openSession(data, remember);
}

/**
 * Sign up — which, against this API, is **not** a create: a sign-in plus a profile patch, so an
 * existing mobile passes straight through. Only this function can see `wasNew` (auth.md).
 */
export async function register({ name, email, mobile, otp, remember = true }) {
  const user = await login({ mobile, otp, remember });
  const wasNew = !user?.name?.trim();
  const profile = {};
  if (name) profile.name = name;
  if (email) profile.email = email;
  return { user: Object.keys(profile).length ? await updateMe(profile) : user, wasNew };
}

/**
 * Email + password sign-in for internal accounts. The `/staff-login` screen does not come here —
 * it uses mobile + OTP — so a credential-less caller gets a message rather than a bare 422.
 */
export async function staffLogin({ email, password, remember = true }) {
  if (!email || !password) {
    throw new Error(
      'Staff login needs email + password. The /staff-login screen signs staff in with mobile + ' +
        'OTP via /auth/login instead — call login() rather than staffLogin() from there.',
    );
  }
  const data = await post('/auth/staff-login', { email, password, remember }, { auth: false });
  return openSession(data, remember);
}

/**
 * End the session locally whatever the server says — a user who clicks "sign out" must end up
 * signed out. What residue an unreachable server leaves, and the hint: docs/flows/consumer/auth.md
 */
export async function logout() {
  try {
    await post('/auth/logout');
  } catch {
    /* best-effort */
  }
  logoutUser();
  return null;
}

/**
 * Re-read the profile and refresh the cached copy guards and headers read. The storage tier is
 * asked for, never defaulted: a bare `writeUser` would promote an unremembered session.
 */
export async function getMe() {
  const user = await get('/auth/me');
  writeUser(user, sessionRemembered());
  return user;
}

/** Same tier rule as {@link getMe} — a profile edit must not promote the session that made it. */
export async function updateMe(body) {
  const user = await patch('/auth/me', body);
  writeUser(user, sessionRemembered());
  return user;
}

/**
 * `GET /me/data-export` — the DPDP right of access, returned as-is: `schemaVersion`,
 * `redactionRule` and `excluded[]` are part of the answer, and a counterparty is an opaque ref.
 */
export async function exportMyData() {
  return get('/me/data-export');
}

/**
 * `POST /me/erasure` — a filed request, not a deletion: the account may be the counterparty on a
 * live tenancy, so the decision is reviewed and the response is the record.
 */
export async function requestErasure({ reason } = {}) {
  return post('/me/erasure', { reason: reason || '' });
}

/**
 * `GET /me/erasure` — the caller's own requests. Only pending and rejected ones come back: an
 * approved request has taken the account with it.
 */
export async function myErasureRequests() {
  return unwrapPage(await get('/me/erasure'));
}

/**
 * Persist a token-bearing `AuthResponse`: access token and user share one storage tier, so
 * "remember this device" governs both and neither can outlive the other.
 */
function openSession(data, remember) {
  persistTokens(data, remember);
  writeUser(data.user, remember);
  return data.user;
}
