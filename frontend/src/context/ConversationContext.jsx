import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { openMessageStream, unreadCount as fetchUnreadCount } from '../services/conversationService.js';
import { getAppFlags } from '../services/settingsService.js';
import { useAuth } from './AuthContext.jsx';

/* The chat badge count, held once for the whole app because the answer is a network call and a
   network call cannot happen during render. Signed out holds zero: the inbox 401s without a session. */
const ConversationContext = createContext(null);

export function ConversationProvider({ children }) {
  const { isIn } = useAuth();
  const [unread, setUnread] = useState(0);
  const [streamConnected, setStreamConnected] = useState(false);
  const [messagingEnabled, setMessagingEnabled] = useState(true);
  const subscribers = useRef(new Set());

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
      // An unreachable inbox shows no badge rather than a stale one: a badge the user cannot clear
      // by reading anything is worse than no badge.
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

  /* Re-reads when another tab writes, focus returns, or the network comes back. Focus and
     visibilitychange fire together on a tab switch, so one read answers both. */
  useEffect(() => {
    if (!isIn) return undefined;
    let last = 0;
    const onChange = () => {
      if (document.hidden || Date.now() - last < 1000) return;
      last = Date.now();
      refresh();
    };
    window.addEventListener('storage', onChange);
    window.addEventListener('focus', onChange);
    window.addEventListener('online', onChange);
    document.addEventListener('visibilitychange', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('focus', onChange);
      window.removeEventListener('online', onChange);
      document.removeEventListener('visibilitychange', onChange);
    };
  }, [isIn, refresh]);

  useEffect(() => {
    let alive = true;
    const sync = () => getAppFlags()
      .then((flags) => { if (alive) setMessagingEnabled(flags?.inAppMessaging !== false); })
      .catch(() => { if (alive) setMessagingEnabled(true); });
    sync();
    window.addEventListener('draazy-settings-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      alive = false;
      window.removeEventListener('draazy-settings-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const subscribe = useCallback((fn) => {
    subscribers.current.add(fn);
    return () => subscribers.current.delete(fn);
  }, []);

  useEffect(() => {
    if (!isIn || !messagingEnabled) {
      setStreamConnected(false);
      return undefined;
    }
    let stopped = false;
    let retry = 1000;
    let controller = null;
    let timer = null;
    const start = () => {
      if (stopped || document.hidden) return;
      controller = new AbortController();
      openMessageStream({
        signal: controller.signal,
        onOpen: () => {
          retry = 1000;
          setStreamConnected(true);
        },
        onEvent: (event) => {
          if (event.type === 'message') refresh();
          subscribers.current.forEach((fn) => fn(event));
        },
      }).catch((err) => {
        if (err?.name !== 'AbortError') setStreamConnected(false);
      }).finally(() => {
        controller = null;
        if (stopped) return;
        setStreamConnected(false);
        timer = window.setTimeout(start, retry);
        retry = Math.min(retry * 2, 30000);
      });
    };
    const visible = () => {
      if (document.hidden) return;
      if (!controller) start();
    };
    start();
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [isIn, messagingEnabled, refresh]);

  const value = useMemo(() => ({ unread, refresh, subscribe, streamConnected }), [unread, refresh, subscribe, streamConnected]);
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversationUnread() {
  const ctx = useContext(ConversationContext);
  if (!ctx) throw new Error('useConversationUnread must be used within a ConversationProvider');
  return ctx;
}
