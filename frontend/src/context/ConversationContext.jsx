import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { unreadCount as fetchUnreadCount } from '../services/conversationService.js';
import { useAuth } from './AuthContext.jsx';

/* The chat badge count, held once for the whole app because the answer is a network call and a
   network call cannot happen during render. Signed out holds zero: the inbox 401s without a session. */
const ConversationContext = createContext(null);

export function ConversationProvider({ children }) {
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

  /* Re-reads when another tab writes, so the badge does not sit stale behind a second window. */
  useEffect(() => {
    if (!isIn) return undefined;
    const onChange = () => { refresh(); };
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
    };
  }, [isIn, refresh]);

  const value = useMemo(() => ({ unread, refresh }), [unread, refresh]);
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversationUnread() {
  const ctx = useContext(ConversationContext);
  if (!ctx) throw new Error('useConversationUnread must be used within a ConversationProvider');
  return ctx;
}
