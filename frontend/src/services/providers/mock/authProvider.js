/**
 * Mock auth provider — wraps lib/auth.js (localStorage). This is how the app is developed and
 * demoed with no backend running, so it stays the default and must remain fully functional.
 *
 * Kept method-for-method identical to `providers/http/authProvider.js` so `authService.js` is a
 * true seam and `AuthContext` never learns which side it is talking to.
 */
import {
  loginUser as _loginUser,
  logoutUser as _logoutUser,
  readUser as _readUser,
  registerUser as _registerUser,
  staffLoginUser as _staffLoginUser,
  writeUser as _writeUser,
  withPermissions,
} from '../../../lib/auth.js';
import { withOwnerId } from '../../../lib/data/ownerIdentity.js';

/**
 * Attach the account id the rest of the mock keys its owner-scoped data on.
 *
 * The real API issues this id and hands it back with the session; here it is resolved once, at
 * sign-in, and then carried on the session object exactly as the token's subject would be. Doing it
 * at sign-in rather than at every read is what makes the id an *identity* rather than a derived
 * value: change the account's mobile afterwards and the deals, offers and visits stay findable.
 *
 * `remember` is threaded through so re-persisting the stamped user cannot silently promote a
 * tab-scoped session into a remembered one.
 */
function stamp(user, remember = true) {
  const stamped = withOwnerId(user);
  if (stamped !== user) _writeUser(stamped, remember);
  return withPermissions(stamped);
}

/**
 * No-op OTP dispatch. The delay is intentional: it preserves the "Sending…" affordance that the
 * real network round-trip provides, so the sign-in UX is identical in both modes. Any 6 digits are
 * then accepted — this is a prototype session, not authentication.
 */
export const sendOtp = () => new Promise((resolve) => setTimeout(() => resolve({ otpSent: true }), 700));

export const login = (data) => Promise.resolve(stamp(_loginUser(data), data?.remember !== false));

/** Records the account in the local registry, then opens a session. `otp` is ignored here. */
export const register = (data) => {
  _registerUser(data);
  return Promise.resolve(stamp(_loginUser(data), data?.remember !== false));
};

export const staffLogin = (data) => Promise.resolve(stamp(_staffLoginUser(data)));

export const logout = () => Promise.resolve(_logoutUser());

export const getMe = () => Promise.resolve(withPermissions(_readUser()));

export const updateMe = (body) => {
  const user = _readUser();
  if (!user) return Promise.resolve(null);
  const updated = { ...user, ...body };
  _writeUser(updated);
  return Promise.resolve(withPermissions(updated));
};
