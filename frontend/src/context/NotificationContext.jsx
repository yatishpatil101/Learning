import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { unreadCount as fetchUnreadCount } from '../services/notificationService.js';
import { useAuth } from './AuthContext.jsx';
import { useConversationUnread } from './ConversationContext.jsx';

const NotificationContext = createContext(null);
const POLL_MS = 60_000;
// The stream says when the count changes, but only from the server instance holding it, so a slow
// poll still catches a notification written on another instance.
const STREAM_POLL_MS = 300_000;

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
  const { subscribe, streamConnected } = useConversationUnread();
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState('loading');

  const lastRefreshAt = useRef(0);
  const streamUp = useRef(streamConnected);
  streamUp.current = streamConnected;

  const refresh = useCallback(async () => {
    lastRefreshAt.current = Date.now();
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
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onFocus = () => { refresh(); };
    // One fixed timer: the stream reconnects every ~2 minutes, so a timer keyed on its state never fires.
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const due = streamUp.current ? STREAM_POLL_MS : POLL_MS;
      if (Date.now() - lastRefreshAt.current >= due - 1_000) refresh();
    }, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  useEffect(() => subscribe((event) => {
    if (event.type === 'notification') refresh();
  }), [subscribe, refresh]);

  const value = useMemo(() => ({ unread, refresh, status }), [unread, refresh, status]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within a NotificationProvider');
  return ctx;
}
