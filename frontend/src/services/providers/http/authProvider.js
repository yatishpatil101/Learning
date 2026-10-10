// Login is two round-trips (send OTP, then verify), so `sendOtp` is its own method.
import { get, patch, persistTokens, post, unwrapPage } from '../../http.js';
import { logoutUser, sessionRemembered, writeUser } from '../../../lib/auth.js';

/** The step that spends an SMS; `resendAfterSeconds` and the Turnstile header: docs/flows/consumer/auth.md */
export const sendOtp = ({ mobile, turnstileToken }) => post(
  '/auth/login',
  { mobile },
  { auth: false, headers: turnstileToken ? { 'CF-Turnstile-Response': turnstileToken } : undefined },
);

/** `remember` goes on the wire: only the server can scope the refresh cookie to match. */
export async function login({ mobile, otp, remember = true }) {
  const data = await post('/auth/login', { mobile, otp, remember }, { auth: false });
  return openSession(data, remember);
}

/** Not a create: a sign-in plus a profile patch, so an existing mobile passes through (auth.md). */
export async function register({ name, email, mobile, otp, remember = true }) {
  const user = await login({ mobile, otp, remember });
  const wasNew = !user?.name?.trim();
  const profile = {};
  // A verified name is locked server-side; sending a differently typed one would 409 the sign-up.
  if (name && !user?.verified) profile.name = name;
  if (email) profile.email = email;
  if (!Object.keys(profile).length) return { user, wasNew };
  try {
    return { user: await updateMe(profile), wasNew };
  } catch (err) {
    // The OTP is spent and the session open, so a retry must patch the profile, not log in again.
    err.signedIn = { wasNew, verified: Boolean(user?.verified) };
    throw err;
  }
}

/** Resolves `{ mfa: 'totp' | 'enrol', challenge }`, never a session: only the second factor opens one. */
export const staffLogin = ({ email, password }) => post('/auth/staff-login', { email, password }, { auth: false });

/** Authenticator or recovery code against the step-one challenge; opens the session. */
export async function staffVerify({ challenge, code, remember = true }) {
  const data = await post('/auth/staff-login/verify', { challenge, code, remember }, { auth: false });
  return openSession(data, remember);
}

/** First sign-in only: a new authenticator secret, `{ secret, otpauthUri }`. */
export const staffEnrol = ({ challenge }) => post('/auth/staff-login/enrol', { challenge }, { auth: false });

/** Confirms the new authenticator; resolves the user plus the one-time `recoveryCodes`. */
export async function staffConfirm({ challenge, code, remember = true }) {
  const data = await post('/auth/staff-login/enrol/confirm', { challenge, code, remember }, { auth: false });
  return { user: openSession(data, remember), recoveryCodes: data.recoveryCodes || [] };
}

/** The colleague sets their own password from the invite token. Not a sign-in. */
export const redeemStaffInvite = ({ token, password }) =>
  post('/auth/staff-invite/redeem', { token, password }, { auth: false });

/** Ends the session locally whatever the server says; offline residue: docs/flows/consumer/auth.md */
export async function logout() {
  try {
    await post('/auth/logout');
  } catch {
    /* best-effort */
  }
  logoutUser();
  return null;
}

/** The tier is asked for, never defaulted: a bare `writeUser` would promote an unremembered session. */
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

/** Returned as-is: `schemaVersion`, `redactionRule` and `excluded[]` are part of the DPDP answer. */
export async function exportMyData() {
  return get('/me/data-export');
}

/** A filed request, not a deletion: the account may be a counterparty on a live tenancy. */
export async function requestErasure({ reason } = {}) {
  return post('/me/erasure', { reason: reason || '' });
}

/** Only pending and rejected requests come back: an approved one has taken the account with it. */
export async function myErasureRequests() {
  return unwrapPage(await get('/me/erasure'));
}

/** Token and user share one storage tier, so neither can outlive the other. */
function openSession(data, remember) {
  persistTokens(data, remember);
  writeUser(data.user, remember);
  return data.user;
}
