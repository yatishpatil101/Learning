import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { logoutUser, readAccessToken, readUser, sessionHinted } from '../lib/auth.js';
import * as authService from '../services/authService.js';
import { ApiError, NetworkError, restoreSession } from '../services/http.js';

const AuthContext = createContext(null);

/**
 * Session state for the whole app.
 *
 * All mutations go through `services/authService.js` rather than `lib/auth.js` directly, so the
 * context deals in one vocabulary and the http provider owns the wire.
 *
 * **On `loading`.** The cached user is read synchronously so the first paint is already correct and
 * a returning user never sees a flash of the signed-out UI. That cache still has to be revalidated
 * — the session may have been revoked, or the profile changed on another device — and `loading`
 * covers exactly that revalidation. Route guards must not render a decision while it is true, or a
 * hard refresh can bounce a signed-in user to /signin.
 *
 * It also covers the case where there is no cached user but the server's session-hint cookie says
 * there is a session — a Safari user whose web storage ITP cleared out from under a live 30-day
 * refresh cookie. That boot has nothing to paint optimistically and everything to recover.
 */
export function AuthProvider({ children }) {
  // Lazy init: read storage once (rerender-lazy-state-init).
  const [user, setUser] = useState(() => readUser());
  // A hinted session with no cached user still has to revalidate — that is the whole ITP case below
  // — so it must start `loading` too, or the guards would render "signed out" and bounce the user to
  // /signin while the restore is still in flight.
  const [loading, setLoading] = useState(() => !!readUser() || sessionHinted());

  /* Bumped by every deliberate change of identity below, and read by every background write so a
     slow reply cannot land on a session that has since moved on. Without it a `getMe()` in flight
     when the user signs out resolves afterwards and re-signs them in — and worse than a render
     glitch, `authProvider.getMe` writes the profile back to storage on the way through, so the
     cleared cache returns too. A ref rather than state: nothing renders from it, and it has to be
     readable by a closure created before the change it is guarding against.

     Declared above the boot effect because that effect needs it too. The sign-out affordance is
     reachable while the boot revalidation is still in flight — the navbar renders from the cached
     user without gating on `loading` — and the ITP path can now prepend a whole `POST /auth/refresh`
     to the `getMe()`, so the window is wider than it was. */
  const sessionGen = useRef(0);

  useEffect(() => {
    if (!loading) return undefined;
    let cancelled = false;
    const mine = sessionGen.current;
    // `cancelled` only covers unmount. This covers the user signing out mid-revalidation, which is
    // a live possibility rather than a theoretical one: the reply must not resurrect the identity
    // they just discarded.
    const stale = () => cancelled || sessionGen.current !== mine;
    (async () => {
      try {
        // Cold boot with no access token. Ordinarily that means signed out, and the http client's
        // 401 recovery deliberately declines to refresh on it. Once a week, on Safari, it means
        // something else: ITP clears script-writable storage after seven days without first-party
        // interaction, taking the cached user and access token while leaving the refresh cookie —
        // server-set, and so exempt — valid for the rest of its 30 days. Without this branch nothing
        // would ever spend that cookie, and "remember this device for 30 days" would mean seven.
        //
        // `sessionHinted()` is checked here and not left to `loading`, whose other disjunct is a
        // cached user. The two are not the same question, and a cached user with no hint is
        // reachable: `getMe` writes the profile to `localStorage` while an unremembered session's
        // tokens stay in `sessionStorage`, so after a browser restart the blob outlives both the
        // tokens and the session-scoped cookies. Refreshing on that costs a guaranteed 401 — and
        // since nothing would clear the blob, it would recur on every cold boot forever. Hence the
        // `logoutUser()`: when the answer is definitive, erase the evidence that asked the question.
        //
        // The erase is inside `stale()` for the same reason `setUser` is, and it matters more. A
        // sign-in that starts and finishes inside this restore's round trip has already written a
        // fresh access token, user blob and marker cookie; an ungated `logoutUser()` would delete
        // all three on behalf of a session that is minutes dead. The result is the worst reachable
        // state: React still says "signed in" (its `setUser` was skipped), there is no token, and
        // `http.js`'s 401 recovery cannot rescue it because that path requires an access token to
        // exist. Reloading would not help either, the marker having been deleted too.
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
        // Distinguish "the server says no" from "we couldn't ask". A rejected session (401 that the
        // http client could not refresh) must clear. An unreachable server must not: signing users
        // out on every flaky-connection page load would be worse than trusting the cache for one
        // more moment — the next real API call will 401 and clear it properly. A 429 or a 5xx is the
        // same kind of non-answer as a dead socket: the server declined to reply, it did not reply
        // "no", and `/auth/refresh` shares an IP-keyed write budget with every anonymous caller
        // behind the same NAT.
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

  /**
   * Sign in, and hand the caller the account the *server* returned.
   *
   * The returned user matters to exactly one screen: `/staff-login` has to know the role and team
   * of the account that just authenticated, and it must not read them from `user` on the next
   * render — the redirect happens inside the same handler, before that render exists. Everything
   * else ignores the return value, which is why this stayed a bare `setUser` until now.
   */
  const login = useCallback(async (data) => {
    sessionGen.current += 1;
    const who = await authService.login(data);
    setUser(who);
    return who;
  }, []);
  const register = useCallback(async (data) => {
    sessionGen.current += 1;
    setUser(await authService.register(data));
  }, []);
  /* Returns the account for the same reason `login` does, and to the same one caller: the server
     resolves the identity, so what the console asked for and what it got are not necessarily the
     same thing, and the redirect is decided before the next render exists. (The reason predates
     the mock's deletion and outlived it — the mock resolved a seeded internal account from the
     mobile; the server now resolves the real one. Either way the caller cannot assume.) */
  const staffLogin = useCallback(async (data) => {
    sessionGen.current += 1;
    const who = await authService.staffLogin(data);
    setUser(who);
    return who;
  }, []);

  const logout = useCallback(async () => {
    // Drop the user first so the UI reflects the intent immediately, even if the server call is slow.
    sessionGen.current += 1;
    setUser(null);
    await authService.logout();
  }, []);

  const update = useCallback(async (patch) => {
    sessionGen.current += 1;
    setUser(await authService.updateMe(patch));
  }, []);

  /**
   * Re-read the profile from the server, for the things the server changes without being asked.
   *
   * The revalidation above is mount-only, so anything the server derives from what the user *did*
   * — rather than from a patch they submitted — is invisible for the rest of the session. The one
   * that matters today is `listingsCount`: posting your first listing makes you an owner on the
   * server, and `hasEverListed` would keep saying otherwise until the next full page load, which is
   * the opposite of the bug that predicate exists to fix.
   *
   * Deliberately swallows failures. A stale persona is a slightly wrong plan card; signing someone
   * out because a background refresh failed right after they posted a listing is not a trade worth
   * making. The next real call will 401 and clear the session properly if it truly is dead. It is
   * swallowed but not silent: without the warning a refresh that 500s is indistinguishable from a
   * server that never incremented the counter — i.e. from the very bug this exists to fix — and
   * whoever debugs "I posted a listing and still see the seeker card" would have no way to tell the
   * two halves apart.
   *
   * Discards its own result if the session changed while it was in flight. This is the only write
   * here nobody asked for, so it is the only one that can arrive after the user has signed out,
   * signed in as someone else, or saved a profile edit — and in each case the reply it is holding
   * describes an account that is no longer the current one.
   */
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
      /* Has this account EVER posted a listing — the lifetime tally, including listings since
         rejected or archived. The owner-vs-seeker persona for surfaces that have no listing data of
         their own to consult (the plan tiers, the referral badge).

         Deliberately NOT `role === 'owner'`, which is what stood at those call sites: nothing in the
         application assigns that role — both signup paths mint `buyer`, and `setRole` has no call
         site outside account creation — so the test was a constant false on every real account, and
         only the demo seed's hardcoded roles made it look answered. `listingsCount` is the server's
         lifetime counter, maintained at the point of posting (User.recordListingPosted).

         NOT interchangeable with Dashboard.jsx's `isOwner`, and named apart from it on purpose.
         That one is `listings.length > 0 || ownsInventory` — LIVE inventory from `GET /me/listings`,
         which is the right question for a screen that manages what is currently posted, and which
         answers false for someone whose only listing was taken down. This one answers true for
         them, because "which side of the marketplace did you come for" does not stop being true
         when a listing is rejected. Two questions, two answers; giving them one name is how they
         would quietly become one wrong answer. */
      hasEverListed: (user?.listingsCount ?? 0) > 0,
      team: user?.team ?? null,
      login,
      register,
      staffLogin,
      logout,
      update,
      refreshUser,
    }),
    [user, loading, login, register, staffLogin, logout, update, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
