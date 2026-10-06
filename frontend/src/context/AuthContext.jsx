import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { logoutUser, readAccessToken, readUser, sessionHinted } from '../lib/auth.js';
import * as authService from '../services/authService.js';
import { clearConversationDeviceState } from '../services/conversationService.js';
import { unregisterPushSubscription } from '../services/notificationService.js';
import { ApiError, NetworkError, restoreSession } from '../services/http.js';
import { primeMeBootstrap } from '../services/meBootstrapService.js';

const AuthContext = createContext(null);

async function removePushSubscription() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/sw.js');
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return;
    await unregisterPushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch {
    /* best-effort */
  }
}

/** What `loading` covers, and the ITP cold-boot case: docs/flows/consumer/auth.md */
export function AuthProvider({ children }) {
  // Lazy init: read storage once (rerender-lazy-state-init).
  const [user, setUser] = useState(() => readUser());
  // A hinted session with no cached user still has to revalidate, so it must start `loading` too —
  // otherwise the guards render "signed out" and bounce the user while the restore is in flight.
  const [loading, setLoading] = useState(() => Boolean(user) || sessionHinted());

  /* Bumped by every deliberate change of identity, and read by every background write so a slow
     reply cannot land on a session that has since moved on — docs/flows/consumer/auth.md. */
  const sessionGen = useRef(0);

  useEffect(() => {
    if (!loading) return undefined;
    let cancelled = false;
    const mine = sessionGen.current;
    // `cancelled` only covers unmount; this also covers the user signing out mid-revalidation, so
    // the reply cannot resurrect the identity they just discarded.
    const stale = () => cancelled || sessionGen.current !== mine;
    (async () => {
      try {
        // Cold boot with no access token usually means signed out, but on Safari it can mean ITP
        // cleared storage around a live refresh cookie — docs/flows/consumer/auth.md.
        if (!readAccessToken() && !(sessionHinted() && await restoreSession())) {
          if (!stale()) {
            logoutUser();
            setUser(null);
          }
          return;
        }
        // A cached user with a dead token must not stay "signed in": getMe() 401s, the http client's
        // refresh attempt fails, and the session is cleared.
        const fresh = await authService.getMe();
        if (!stale()) setUser(fresh ?? null);
      } catch (err) {
        // Distinguish "the server says no" from "we couldn't ask": only a rejected session clears,
        // because a 429, a 5xx or a dead socket is a non-answer (docs/flows/consumer/auth.md).
        const answered = !(err instanceof NetworkError) && !(err instanceof ApiError && err.status !== 401);
        if (!stale() && answered) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Mount-only: `loading` is initialised once and never set back to true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Return the server-resolved account: callers act before React renders the new auth state. */
  const login = useCallback(async (data) => {
    sessionGen.current += 1;
    const who = await authService.login(data);
    primeMeBootstrap();
    setUser(who);
    return who;
  }, []);
  const register = useCallback(async (data) => {
    sessionGen.current += 1;
    const { user: who, wasNew } = await authService.register(data);
    primeMeBootstrap();
    setUser(who);
    return wasNew;
  }, []);
  /* Return the account for the same reason `login` does: the server resolves the identity, so what
     the console asked for and what it got are not necessarily the same thing. */
  const staffVerify = useCallback(async (data) => {
    sessionGen.current += 1;
    const who = await authService.staffVerify(data);
    primeMeBootstrap();
    setUser(who);
    return who;
  }, []);
  const staffConfirm = useCallback(async (data) => {
    sessionGen.current += 1;
    const result = await authService.staffConfirm(data);
    primeMeBootstrap();
    setUser(result.user);
    return result;
  }, []);

  const logout = useCallback(async () => {
    // Drop the user first so the UI reflects the intent immediately, even if the server call is slow.
    sessionGen.current += 1;
    setUser(null);
    try {
      await removePushSubscription();
      await clearConversationDeviceState();
      localStorage.removeItem('draazy.listings.lastSearch.v1');
      localStorage.removeItem('draazy.flatmates.lastSearch.v1');
      Object.keys(localStorage)
        .filter((key) => key.startsWith('dzDraft:') || key.startsWith('draazyOwnerKYC:'))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      /* ignore */
    }
    await authService.logout();
  }, []);

  const update = useCallback(async (patch) => {
    sessionGen.current += 1;
    setUser(await authService.updateMe(patch));
  }, []);

  /* Re-read server-owned fields like `listingsCount`; ignore stale results after session changes. */
  const refreshUser = useCallback(async () => {
    const mine = sessionGen.current;
    try {
      const fresh = await authService.getMe();
      if (fresh && sessionGen.current === mine) setUser(fresh);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[auth] background profile refresh failed', err);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isIn: !!user,
      role: user?.role ?? null,
      /* Has this account EVER posted a listing (the server's lifetime tally), for surfaces with no
         listing data of their own. Not `role`, and not Dashboard's live `isOwner` — see auth.md. */
      hasEverListed: (user?.listingsCount ?? 0) > 0,
      login,
      register,
      staffVerify,
      staffConfirm,
      logout,
      update,
      refreshUser,
    }),
    [user, loading, login, register, staffVerify, staffConfirm, logout, update, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
