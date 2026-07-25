import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { loginUser, logoutUser, readUser, registerUser, staffLoginUser, writeUser } from '../lib/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Lazy init: read localStorage once (rerender-lazy-state-init).
  const [user, setUser] = useState(() => readUser());

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
