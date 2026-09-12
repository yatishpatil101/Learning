import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { unreadCount as fetchUnreadCount } from '../services/conversationService.js';
import { useAuth } from './AuthContext.jsx';

/**
 * The chat attention count for the navbar badge, held once for the whole app.
 *
 * ## Why this replaced `useChatUnread`
 *
 * `lib/chat.js` exposed `useChatUnread()`, a `useSyncExternalStore` hook over localStorage — a
 * synchronous read the navbar could call inline during render. Against the API the same question is
 * a network call, and a network call cannot happen during render. So the count becomes state,
 * fetched once and refreshed on demand. Identical shape to `NotificationContext` and `SavedContext`,
 * for identical reasons.
 *
 * That hook (and the store-change event behind it) has since been **deleted** rather than left
 * unused: it answered the same question from the mock store, which is empty in http mode, so
 * leaving it in place meant a one-line import could silently zero the badge.
 *
 * ## Signed out
 *
 * The inbox is caller-scoped and the API 401s without a session, so this holds zero rather than
 * reading an anonymous store. No badge is the right thing for a signed-out user either way.
 */
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

  /**
   * The mock provider writes through `lib/chat.js`, which broadcasts `dz-convs-change` on every
   * save. The navbar used to subscribe to that itself; the listener lives here now so the mock keeps
   * its live-update behaviour without the navbar knowing which provider is active. The http provider
   * never emits it and does not need to — its writes go through `refresh`.
   */
  useEffect(() => {
    if (!isIn) return undefined;
    const onChange = () => { refresh(); };
    window.addEventListener('dz-convs-change', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('dz-convs-change', onChange);
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
