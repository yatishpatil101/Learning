import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { readUser } from '../lib/auth.js';
import { claimReferralCredits } from '../lib/store/referrals.js';
import * as authService from '../services/authService.js';
import { isHttpDomain } from '../services/config.js';
import { NetworkError } from '../services/http.js';

const AuthContext = createContext(null);

/**
 * Session state for the whole app.
 *
 * All mutations go through `services/authService.js` rather than `lib/auth.js` directly, so the
 * same context works against the localStorage mock and the live API without change.
 *
 * **On `loading`.** The cached user is read synchronously so the first paint is already correct and
 * a returning user never sees a flash of the signed-out UI. Against the live API that cache still
 * has to be revalidated (the session may have been revoked, or the profile changed on another
 * device), and `loading` covers exactly that revalidation. Route guards must not render a decision
 * while it is true, or a hard refresh can bounce a signed-in user to /signin.
 *
 * On mocks there is nothing to revalidate — storage *is* the source of truth — so `loading` stays
 * false throughout and mock-mode rendering is unchanged, with no spinner flash.
 */
export function AuthProvider({ children }) {
  // Lazy init: read storage once (rerender-lazy-state-init).
  const [user, setUser] = useState(() => readUser());
  const [loading, setLoading] = useState(() => isHttpDomain('auth') && !!readUser());

  useEffect(() => {
    if (!loading) return undefined;
    let cancelled = false;
    // A cached user with a dead token must not stay "signed in": getMe() 401s, the http client's
    // refresh attempt fails, and the session is cleared.
    authService
      .getMe()
      .then((fresh) => { if (!cancelled) setUser(fresh ?? null); })
      .catch((err) => {
        if (cancelled) return;
        // Distinguish "the server says no" from "we couldn't ask". A rejected session (401 that the
        // http client could not refresh) must clear. An unreachable server must not: signing users
        // out on every flaky-connection page load would be worse than trusting the cache for one
        // more moment — the next real API call will 401 and clear it properly.
        if (!(err instanceof NetworkError)) setUser(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Mount-only: `loading` is initialised once and never set back to true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Referral rewards are queued by the referred friend's action and collected
  // here, so a returning referrer's free-contact / free-listing allowance is up
  // to date before any quota gate runs.
  useEffect(() => {
    if (user?.mobile) claimReferralCredits();
  }, [user?.mobile]);

  const login = useCallback(async (data) => setUser(await authService.login(data)), []);
  const register = useCallback(async (data) => setUser(await authService.register(data)), []);
  const staffLogin = useCallback(async (data) => setUser(await authService.staffLogin(data)), []);

  const logout = useCallback(async () => {
    // Drop the user first so the UI reflects the intent immediately, even if the server call is slow.
    setUser(null);
    await authService.logout();
  }, []);

  const update = useCallback(async (patch) => setUser(await authService.updateMe(patch)), []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isIn: !!user,
      role: user?.role ?? null,
      team: user?.team ?? null,
      login,
      register,
      staffLogin,
      logout,
      update,
    }),
    [user, loading, login, register, staffLogin, logout, update],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
