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
} from '../../../lib/auth.js';

/**
 * No-op OTP dispatch. The delay is intentional: it preserves the "Sending…" affordance that the
 * real network round-trip provides, so the sign-in UX is identical in both modes. Any 6 digits are
 * then accepted — this is a prototype session, not authentication.
 */
export const sendOtp = () => new Promise((resolve) => setTimeout(() => resolve({ otpSent: true }), 700));

export const login = (data) => Promise.resolve(_loginUser(data));

/** Records the account in the local registry, then opens a session. `otp` is ignored here. */
export const register = (data) => {
  _registerUser(data);
  return Promise.resolve(_loginUser(data));
};

export const staffLogin = (data) => Promise.resolve(_staffLoginUser(data));

export const logout = () => Promise.resolve(_logoutUser());

export const getMe = () => Promise.resolve(_readUser());

export const updateMe = (body) => {
  const user = _readUser();
  if (!user) return Promise.resolve(null);
  const updated = { ...user, ...body };
  _writeUser(updated);
  return Promise.resolve(updated);
};
