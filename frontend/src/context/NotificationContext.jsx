import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { unreadCount as fetchUnreadCount } from '../services/notificationService.js';
import { useAuth } from './AuthContext.jsx';

const NotificationContext = createContext(null);
const POLL_MS = 60_000;

function clearLegacyNotificationStorage() {
  try {
    localStorage.removeItem('dzDismissedNotifs');
    Object.keys(localStorage)
      .filter((key) => key.startsWith('dzNotifications:'))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // localStorage may be disabled; a cleanup miss must not block the app shell.
  }
}

export function NotificationProvider({ children }) {
  const { isIn } = useAuth();
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState('loading');

  const refresh = useCallback(async () => {
    if (!isIn) {
      setUnread(0);
      setStatus('ready');
      return 0;
    }
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const n = await fetchUnreadCount();
      setUnread(n);
      setStatus('ready');
      return n;
    } catch {
      setUnread(0);
      setStatus('error');
      return 0;
    }
  }, [isIn]);

  useEffect(() => {
    clearLegacyNotificationStorage();
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onStoreWrite = () => { refresh(); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onFocus = () => { refresh(); };
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    window.addEventListener('pn:store', onStoreWrite);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('pn:store', onStoreWrite);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const value = useMemo(() => ({ unread, refresh, status }), [unread, refresh, status]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within a NotificationProvider');
  return ctx;
}
