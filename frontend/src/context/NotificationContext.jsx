import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { unreadCount as fetchUnreadCount } from '../services/notificationService.js';
import { useAuth } from './AuthContext.jsx';

/**
 * The unread-notification count for the navbar bell, held once for the whole app.
 *
 * ## Why this exists
 *
 * `unreadNotifCount()` was a synchronous localStorage read, so the navbar could call it inline
 * during render and re-run it on every store event. Against the API the same question is a network
 * call, and a network call cannot happen during render — so the count has to be state that is
 * fetched once and refreshed on demand. Same shape as `SavedContext`, for the same reason.
 *
 * ## Why the count is not `list().length`
 *
 * There is no unread-count endpoint, so the provider counts a large page. That is a real ceiling
 * and it is warned about in the provider — but it must be counted in **one** place, not once per
 * consumer, or the navbar and the page would disagree after any action.
 *
 * ## Signed out
 *
 * The inbox is caller-scoped and the API 401s without a session, so this holds zero rather than
 * reading an anonymous store. The bell renders no badge, which is what a signed-out user should see
 * regardless of provider.
 */
const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { isIn } = useAuth();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!isIn) {
      setUnread(0);
      return 0;
    }
    try {
      const n = await fetchUnreadCount();
      setUnread(n);
      return n;
    } catch {
      // An unreachable inbox shows no badge rather than a stale one. That is the safe direction:
      // a missing badge under-promises, whereas a stale badge sends the user to a page that cannot
      // explain why the number was wrong.
      setUnread(0);
      return 0;
    }
  }, [isIn]);

  useEffect(() => {
    let alive = true;
    if (!isIn) {
      setUnread(0);
      return undefined;
    }
    fetchUnreadCount()
      .then((n) => { if (alive) setUnread(n); })
      .catch(() => { if (alive) setUnread(0); });
    return () => { alive = false; };
  }, [isIn]);

  /**
   * The mock provider writes through `lib/store`, which broadcasts `pn:store` on every write. The
   * navbar used to listen for that itself and re-read synchronously; now the listener lives here so
   * the mock keeps its live-update behaviour without the navbar knowing which provider is active.
   * The http provider never emits it, and does not need to — its writes go through `refresh`.
   */
  useEffect(() => {
    if (!isIn) return undefined;
    const onStoreWrite = () => { refresh(); };
    window.addEventListener('pn:store', onStoreWrite);
    return () => window.removeEventListener('pn:store', onStoreWrite);
  }, [isIn, refresh]);

  const value = useMemo(() => ({ unread, refresh }), [unread, refresh]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within a NotificationProvider');
  return ctx;
}
