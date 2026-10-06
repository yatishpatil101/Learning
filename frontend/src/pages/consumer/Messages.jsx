import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../styles/routes/messages.css';
import SharedReportModal from '../../components/ReportModal.jsx';
import { OWNER_REPORT_REASONS } from '../../lib/reportReasons.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  deleteMessageForMe,
  drainPendingChats,
  getConversation,
  listConversations,
  markConversationRead,
  replyToConversation,
  sendConversationPhoto,
  sendTyping,
  setConversationBlocked,
  updateConversationState,
} from '../../services/conversationService.js';
import { useConversationUnread } from '../../context/ConversationContext.jsx';
import Inbox from './messages/Inbox.jsx';
import Thread from './messages/Thread.jsx';

// Canned openers keep a cold thread moving — the questions buyers actually ask.
const THREAD_POLL_MS = 20000;
const INBOX_POLL_MS = 60000;
const THREAD_FALLBACK_POLL_MS = 4000;
const INBOX_FALLBACK_POLL_MS = 30000;
const clientId = () => `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const mergeMessages = (serverMessages = [], localMessages = []) => {
  const serverClientIds = new Set(serverMessages.map((m) => m.clientId).filter(Boolean));
  const localOnly = localMessages.filter((m) => (m.pending || m.failed) && m.clientId && !serverClientIds.has(m.clientId));
  return [...serverMessages, ...localOnly];
};

export default function Messages() {
  const { t } = useTranslation();
  const { toast } = useToast();
  /* No canned auto-reply or typing dots: the other end is a real person, so fabricating a reply from them would put
     words in their mouth, and the message would not exist on their device. */
  const { user } = useAuth();
  const { refresh: refreshChatBadge, streamConnected, subscribe } = useConversationUnread();
  const [convs, setConvs] = useState([]);
  const [tab, setTab] = useState('chats');
  const [activeId, setActiveId] = useState(null);
  const [search, setSearch] = useState('');
  const [narrow, setNarrow] = useState(false);
  const [showThread, setShowThread] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [sendError, setSendError] = useState('');
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [typing, setTyping] = useState({});
  const wrapRef = useRef(null);
  const lastMsgId = useRef(null);
  const queue = useRef([]);
  const photoUrls = useRef(new Set());
  const loadedRef = useRef(false);
  const autoOpened = useRef(false);
  const flushQueueRef = useRef(() => {});
  const active = useMemo(() => convs.find((c) => c.id === activeId) || null, [activeId, convs]);
  const typingUntil = active ? typing[active.id] || 0 : 0;

  /* Optimistic local update. */
  const patchConv = useCallback((id, fn) => {
    setConvs((cur) => cur.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  /** Re-read from whichever provider is active, and keep the navbar badge in step. */
  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) { setLoading(true); setError(null); }
    try {
      await drainPendingChats().catch(() => null);
      const list = await listConversations();
      setConvs((cur) => list.map((next) => {
        const old = cur.find((c) => c.id === next.id);
        return old ? { ...old, ...next, messages: next.messages?.length ? mergeMessages(next.messages, old.messages) : old.messages } : next;
      }));
      const firstLoad = !loadedRef.current;
      loadedRef.current = true;
      setError(null);
      setOffline(false);
      flushQueueRef.current();
      // The badge was read at sign-in and the stream keeps it current; only a re-read can find it stale.
      if (!firstLoad) refreshChatBadge();
      return list;
    } catch (err) {
      if (!quiet || !loadedRef.current) setError(err);
      throw err;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [refreshChatBadge]);

  /* Pull one thread's transcript in. */
  /* Pull down from the top of the conversation list to re-read the inbox. */
  const hydrate = useCallback((id, onlyIfNew = false) => {
    if (!id || String(id).startsWith('staged:')) return;
    getConversation(id)
      .then((full) => {
        if (!full) return;
        const lastId = full.messages.at(-1)?.id ?? null;
        if (onlyIfNew && lastId === lastMsgId.current) return;
        lastMsgId.current = lastId;
        patchConv(id, (c) => ({ ...c, ...full, unread: 0, messages: mergeMessages(full.messages, c.messages) }));
        setOffline(false);
        flushQueueRef.current();
        if (!document.hidden) markConversationRead(id).then(refreshChatBadge).catch(() => {});
      })
      .catch(() => {});
  }, [patchConv, refreshChatBadge]);

  /* Load the inbox, having first tried to send anything staged. */
  useEffect(() => { reload().catch(() => {}); }, [reload]);

  useEffect(() => {
    const resize = () => setNarrow((wrapRef.current?.clientWidth || 9999) < 720);
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  // Click-away-to-close for attach popup

  useEffect(() => {
    const onPop = (event) => {
      if (!event.state?.pcThread) setShowThread(false);
  // Mobile: opening a thread pushes a history entry so the hardware/browser back
  // button collapses back to the list instead of leaving the app.
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // Auto-open the first active conversation on desktop (matches chat.js init). A `?c=<id>` or
  // `?openProp=<propertyId>` deep-link opens that specific thread on any width.

  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) reload({ quiet: true }).catch(() => {}); }, streamConnected ? INBOX_POLL_MS : INBOX_FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [reload, streamConnected]);

  useEffect(() => {
    if (!activeId || String(activeId).startsWith('staged:')) return undefined;
    const timer = setInterval(() => { if (!document.hidden) hydrate(activeId); }, streamConnected ? THREAD_POLL_MS : THREAD_FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [activeId, hydrate, streamConnected]);

  useEffect(() => subscribe((event) => {
    const id = event.data?.conversationId;
    if (!id) return;
    if (event.type === 'typing') {
      setTyping((cur) => ({ ...cur, [id]: Date.now() + 5000 }));
      return;
    }
    if (event.type === 'message') reload({ quiet: true }).catch(() => {});
    if (id === activeId && ['message', 'read', 'presence'].includes(event.type)) hydrate(id);
  }), [activeId, hydrate, reload, subscribe]);

  useEffect(() => {
    if (!activeId || typingUntil <= Date.now()) return undefined;
    const timer = window.setTimeout(() => {
      setTyping((cur) => ({ ...cur, [activeId]: 0 }));
    }, typingUntil - Date.now());
    return () => window.clearTimeout(timer);
  }, [activeId, typingUntil]);

  useEffect(() => {
    if (!convs.length) return;
    const params = new URLSearchParams(window.location.search);
    const want = params.get('c');
    const openProp = params.get('openProp');
  /* Chats vs Requests is the `staged` flag and nothing else. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const target = (want && convs.find((c) => c.id === want)) || (openProp && convs.find((c) => c.propertyId === openProp && c.youAre === 'buyer'));
    if (target && target.id !== activeId && !autoOpened.current) {
      autoOpened.current = true;
      openConv(target.id);
    }
    else if (!activeId && (wrapRef.current?.clientWidth || window.innerWidth) >= 720) {
      const first = convs.find((c) => !c.staged && !c.archived);
      if (first) openConv(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-open only follows conversation list changes
  }, [convs.length]);

    // Optimistic: the badge clears on tap, not on the round trip. `markConversationRead` is
    // idempotent on both providers, which is what makes firing it on every open safe.
  const openConv = (id, opts = {}) => {
    if (opts.report) setReportOpen(true);
    patchConv(id, (c) => ({ ...c, unread: 0 }));
    hydrate(id);
    setActiveId(id);
    if ((wrapRef.current?.clientWidth || window.innerWidth) < 720) {
      window.history.pushState({ pcThread: true }, '');
      setShowThread(true);
    } else setShowThread(true);
  };

  const sendNow = useCallback(async ({ conversationId, text, id, replyTo }) => {
    const sent = await replyToConversation(conversationId, { body: text, clientId: id, replyToId: replyTo?.id });
    patchConv(conversationId, (c) => ({
      ...c,
      at: sent.at,
      lastMessage: sent.text,
      messages: c.messages.map((m) => (m.clientId === id ? sent : m)),
    }));
    refreshChatBadge();
    window.setTimeout(() => hydrate(conversationId), 1000);
  }, [hydrate, patchConv, refreshChatBadge]);

  const sendPhotoNow = useCallback(async ({ conversationId, file, caption, id, previewUrl }) => {
    const sent = await sendConversationPhoto(conversationId, { file, caption, clientId: id });
    patchConv(conversationId, (c) => ({
      ...c,
      at: sent.at,
      lastMessage: sent.text || 'Photo',
      messages: c.messages.map((m) => (m.clientId === id ? sent : m)),
    }));
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      photoUrls.current.delete(previewUrl);
    }
    refreshChatBadge();
    window.setTimeout(() => hydrate(conversationId), 1000);
  }, [hydrate, patchConv, refreshChatBadge]);

  const markFailed = useCallback((conversationId, id, message) => {
    patchConv(conversationId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.clientId === id ? { ...m, pending: false, failed: true, error: message } : m)),
    }));
  }, [patchConv]);

  const flushQueue = useCallback(() => {
    const pending = queue.current.splice(0);
    pending.forEach((item) => sendNow(item).catch((err) => markFailed(item.conversationId, item.id, err?.message || 'Not sent')));
  }, [markFailed, sendNow]);
  flushQueueRef.current = flushQueue;

  useEffect(() => {
    const onOnline = () => { setOffline(false); flushQueue(); reload({ quiet: true }).catch(() => {}); };
    const onOffline = () => setOffline(true);
    const onVisible = () => { if (!document.hidden) { reload({ quiet: true }).catch(() => {}); if (activeId) hydrate(activeId); } };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeId, flushQueue, hydrate, reload]);

  const sendText = (text, replyTo = null, retryId = null) => {
    if (!active || active.staged || active.blocked) return;
    setSendError('');
    const body = String(text || '').trim();
    if (!body) return;
    const id = retryId || clientId();
    const at = Date.now();
    // Paint the bubble first; the request follows. A failed send re-reads the thread, so the
    // message disappears rather than sitting there looking delivered.
    if (!retryId) {
      const optimistic = { id: `client:${id}`, clientId: id, from: 'me', text: body, at, read: false, pending: true, replyTo: replyTo ? { id: replyTo.id, body: replyTo.text, author: replyTo.author } : null };
      patchConv(active.id, (c) => ({ ...c, at, lastMessage: body, messages: [...c.messages, optimistic] }));
    } else {
      patchConv(active.id, (c) => ({ ...c, messages: c.messages.map((m) => (m.clientId === id ? { ...m, pending: true, failed: false } : m)) }));
    }
    const item = { conversationId: active.id, text: body, id, replyTo };
    const browserOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (browserOffline) {
      queue.current.push(item);
      setOffline(true);
      return;
    }
    sendNow(item).catch((err) => {
      if (err?.name === 'NetworkError') {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          queue.current.push(item);
          setOffline(true);
          return;
        }
        markFailed(active.id, id, err.message || t('misc.msgSendFailed'));
        return;
      }
      const message = err?.message || t('misc.msgSendFailed');
      setSendError(err?.status === 403 || err?.status === 429 ? message : '');
      markFailed(active.id, id, message);
    });
  };
    // "Propose a visit" routes into the real scheduling flow when it's enabled,
    // instead of posting a fake fixed-time card.

  const sendPhoto = ({ file, caption = '', previewUrl, retry } = {}) => {
    if (!active || active.staged || active.blocked || !file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 8_000_000) {
      toast('Upload a JPEG or PNG up to 8 MB.', 'error');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      return;
    }
    // The wire has no attachment or card type — `MessageCreate` carries `body` alone — so a share chip sends its text
    // and the icon is a local decoration. The recipient sees the sentence.
    setSendError('');
    const id = retry?.clientId || clientId();
    const url = previewUrl || retry?.photoPreviewUrl || URL.createObjectURL(file);
    photoUrls.current.add(url);
    if (!retry) {
      const at = Date.now();
      const optimistic = {
        id: `client:${id}`,
        clientId: id,
        from: 'me',
        text: String(caption || '').trim(),
        at,
        read: false,
        pending: true,
        attachments: [{ url, contentType: file.type, fileName: file.name, local: true }],
        photoFile: file,
        photoPreviewUrl: url,
      };
      patchConv(active.id, (c) => ({ ...c, at, lastMessage: optimistic.text || 'Photo', messages: [...c.messages, optimistic] }));
    } else {
      patchConv(active.id, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.clientId === id ? { ...m, pending: true, failed: false } : m)),
      }));
    }
    sendPhotoNow({ conversationId: active.id, file, caption: caption || retry?.text || '', id, previewUrl: url }).catch((err) => {
      const message = err?.message || 'Photo not sent — try again.';
      setSendError(err?.status === 403 || err?.status === 429 ? message : '');
      markFailed(active.id, id, message);
    });
  };

  const typingNow = useCallback((id) => {
    if (!id || String(id).startsWith('staged:')) return;
    sendTyping(id).catch(() => {});
  }, []);

  const changeState = (id, state) => {
    patchConv(id, (c) => ({ ...c, ...state }));
    updateConversationState(id, state).catch(() => reload({ quiet: true }).catch(() => {}));
  };

  const block = (id, blocked) => {
    patchConv(id, (c) => ({ ...c, blocked }));
    setConversationBlocked(id, blocked).catch(() => reload({ quiet: true }).catch(() => {}));
  };

  const deleteMessage = (conversationId, messageId) => {
    const doomed = convs.find((c) => c.id === conversationId)?.messages.find((m) => m.id === messageId);
    if (doomed?.photoPreviewUrl) {
      URL.revokeObjectURL(doomed.photoPreviewUrl);
      photoUrls.current.delete(doomed.photoPreviewUrl);
    }
    patchConv(conversationId, (c) => ({ ...c, messages: c.messages.filter((m) => m.id !== messageId) }));
    deleteMessageForMe(conversationId, messageId).catch(() => hydrate(conversationId));
  };

  useEffect(() => () => {
    photoUrls.current.forEach((url) => URL.revokeObjectURL(url));
    photoUrls.current.clear();
  }, []);

  // The reveal is a gate read, so it lands after render. It starts closed and only ever opens, which is the safe
  // direction: a thread briefly showing a masked number is a cosmetic delay.
  const wrapCls = 'pc-wrap' + (narrow ? ' is-narrow' : '') + (showThread ? ' show-thread' : '');

  return (
    <div className="messages-page pt-2 pb-6">
      <div className="pc-shell max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          {/* Thread */}
          {/* List */}
        <div ref={wrapRef} className={wrapCls}>
          <Inbox
            t={t}
            items={convs}
            activeId={activeId}
            tab={tab}
            setTab={setTab}
            search={search}
            setSearch={setSearch}
            onOpen={openConv}
            onRetry={() => reload().catch(() => {})}
            onState={changeState}
            onBlock={block}
            loading={loading}
            error={error}
          />
          <Thread
            t={t}
            active={active}
            userId={user?.id}
            offline={offline}
            sendError={sendError}
            onBack={() => { setShowThread(false); if (window.history.state?.pcThread) window.history.back(); }}
            onSend={sendText}
            onPhoto={sendPhoto}
            onPhotoError={(message) => toast(message, 'error')}
            onTyping={typingNow}
            typing={typingUntil > Date.now()}
            onDelete={deleteMessage}
            onState={changeState}
            onBlock={block}
            onReport={() => setReportOpen(true)}
          />
        </div>
      </div>
      {reportOpen && active && !active.group ? (
        <SharedReportModal
          kind="user"
          reasons={OWNER_REPORT_REASONS}
          title={t('misc.msgReportTitle', { name: active.party.name })}
          subtitle={t('misc.msgReportSubtitle')}
          success={t('misc.msgReportSuccess')}
          target={{ id: active.propertyId || active.id, title: active.property.title, ownerName: active.party.name, ownerMobile: active.party.mobile && active.party.mobile.replace(/\D/g, '').length === 10 ? active.party.mobile : '' }}
          onClose={() => setReportOpen(false)}
          toast={toast}
        />
      ) : null}
    </div>
  );
}
