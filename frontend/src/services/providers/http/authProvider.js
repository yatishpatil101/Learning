/**
 * HTTP auth provider — the live counterpart to `providers/mock/authProvider.js`.
 *
 * Method names and return shapes mirror the mock provider exactly, because `authService.js` is the
 * only contract between them and `AuthContext` must not care which one is active.
 *
 * One shape difference is unavoidable and deliberate: real login is **two round-trips**
 * (send OTP, then verify), so `sendOtp` exists as its own method. The mock gained a no-op `sendOtp`
 * so both providers still satisfy the same interface.
 */
import { get, patch, persistTokens, post } from '../../http.js';
import { logoutUser, writeUser } from '../../../lib/auth.js';

/**
 * Step 1: ask the server to dispatch a login code. Resolves to `{ otpSent: true }`.
 *
 * `turnstileToken` rides as a header rather than a body field, which is what keeps the
 * `/auth/login` request schema — and therefore the OpenAPI contract — unchanged (tech-debt D130).
 * Undefined when the challenge is switched off, in which case the header is omitted entirely and
 * the server passes the request through.
 *
 * This is the step worth protecting: it is the one that spends an SMS, so a script hammering it
 * costs real money whether or not it ever guesses a code.
 */
export const sendOtp = ({ mobile, turnstileToken }) => post(
  '/auth/login',
  { mobile },
  { auth: false, headers: turnstileToken ? { 'CF-Turnstile-Response': turnstileToken } : undefined },
);

/**
 * Step 2: verify the code and open a session. First-time mobiles are provisioned server-side as
 * `buyer`, so there is no separate sign-up call — which is why the mock's local user registry has
 * no counterpart here.
 */
export async function login({ mobile, otp, remember = true }) {
  const data = await post('/auth/login', { mobile, otp }, { auth: false });
  return openSession(data, remember);
}

export async function register({ name, email, mobile, otp, remember = true }) {
  const user = await login({ mobile, otp, remember });
  // The server provisions a nameless buyer from the mobile alone — `/auth/login` has no field for a
  // display name — so the sign-up details are applied as a follow-up profile patch.
  const profile = {};
  if (name) profile.name = name;
  if (email) profile.email = email;
  return Object.keys(profile).length ? updateMe(profile) : user;
}

/**
 * Email + password sign-in for internal accounts (contract {@code POST /auth/staff-login}).
 *
 * The `/staff-login` screen does **not** come here: staff sign in on that screen through
 * `sendOtp` + `login`, because D206 removed the password from `POST /users/staff` and a staff
 * account therefore has no password until its holder redeems an emailed invite. This stays because
 * the endpoint is real and accounts that *have* redeemed one can use it — but a caller that reaches
 * it without credentials has almost certainly passed the OTP screen's user object by mistake, and
 * gets a message saying so rather than a bare 422 from the server.
 */
export async function staffLogin({ email, password, remember = true }) {
  if (!email || !password) {
    throw new Error(
      'Staff login needs email + password. The /staff-login screen signs staff in with mobile + ' +
        'OTP via /auth/login instead — call login() rather than staffLogin() from there.',
    );
  }
  const data = await post('/auth/staff-login', { email, password }, { auth: false });
  return openSession(data, remember);
}

/**
 * End the session. The local session is cleared even if the server call fails — a user who clicks
 * "sign out" must end up signed out regardless of connectivity, and the server-side refresh family
 * expires on its own.
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

/** Re-read the profile from the server and refresh the cached copy that guards and headers read. */
export async function getMe() {
  const user = await get('/auth/me');
  writeUser(user);
  return user;
}

export async function updateMe(body) {
  const user = await patch('/auth/me', body);
  writeUser(user);
  return user;
}

/**
 * Persist a token-bearing `AuthResponse`. Tokens and user go into the same storage tier so
 * "remember this device" governs the whole session and neither can outlive the other.
 */
function openSession(data, remember) {
  persistTokens(data, remember);
  writeUser(data.user, remember);
  return data.user;
}
