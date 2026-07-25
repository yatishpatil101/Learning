/**
 * Mock auth provider — wraps lib/auth.js
 */
import {
  readUser as _readUser,
  loginUser as _loginUser,
  staffLoginUser as _staffLoginUser,
  logoutUser as _logoutUser,
  writeUser as _writeUser,
} from '../../../lib/auth.js';

export const login = (data) => Promise.resolve(_loginUser(data));
export const staffLogin = (data) => Promise.resolve(_staffLoginUser(data));
export const logout = () => Promise.resolve(_logoutUser());
export const getMe = () => Promise.resolve(_readUser());
export const updateMe = (patch) => {
  const user = _readUser();
  if (!user) return Promise.resolve(null);
  const updated = { ...user, ...patch };
  _writeUser(updated);
  return Promise.resolve(updated);
};
