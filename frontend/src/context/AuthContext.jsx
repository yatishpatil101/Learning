import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loginUser, logoutUser, readUser, registerUser, staffLoginUser, writeUser } from '../lib/auth.js';
import { claimReferralCredits } from '../lib/store/referrals.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Lazy init: read localStorage once (rerender-lazy-state-init).
  const [user, setUser] = useState(() => readUser());

  // Referral rewards are queued by the referred friend's action and collected
  // here, so a returning referrer's free-contact / free-listing allowance is up
  // to date before any quota gate runs.
  useEffect(() => {
    if (user?.mobile) claimReferralCredits();
  }, [user?.mobile]);

  const login = useCallback((data) => setUser(loginUser(data)), []);
  // Sign-up: record the account in the registry, then start the session.
  const register = useCallback((data) => {
    registerUser(data);
    setUser(loginUser(data));
  }, []);
  const staffLogin = useCallback((data) => setUser(staffLoginUser(data)), []);
  const logout = useCallback(() => {
    logoutUser();
    setUser(null);
  }, []);
  const update = useCallback((patch) => {
    setUser((prev) => {
      const next = { ...prev, ...patch };
      writeUser(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ user, isIn: !!user, role: user?.role ?? null, team: user?.team ?? null, login, register, staffLogin, logout, update }),
    [user, login, register, staffLogin, logout, update],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
