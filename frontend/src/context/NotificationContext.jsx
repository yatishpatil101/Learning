import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { unreadCount as fetchUnreadCount } from '../services/notificationService.js';
import { useAuth } from './AuthContext.jsx';

/* The bell's unread count, held once for the whole app because the answer is a network call and a
   network call cannot happen during render. Signed out holds zero: the inbox 401s without a session. */
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
      // An unreachable inbox shows no badge rather than a stale one: a stale badge sends the user
      // to a page that cannot explain why the number was wrong.
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

  /* `pn:store` is broadcast by lib/localPrefs.js and lib/contact.js on every local write. Listening
     here rather than in the navbar keeps the subscription off the consumer. */
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
