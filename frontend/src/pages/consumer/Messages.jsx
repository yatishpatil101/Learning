import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import PropertyImage from '../../components/ui/PropertyImage.jsx';
import '../../styles/routes/messages.css';
import { MessageBubble, TypingDots } from '../../components/chat/ChatPrimitives.jsx';
import SharedReportModal, { OWNER_REPORT_REASONS } from '../../components/ReportModal.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { digits, fmtPhone } from '../../lib/contact.js';
import { dayLabel, relTime, canRevealParty, lastAt } from '../../lib/chat.js';
import usePullToRefresh from '../../lib/usePullToRefresh.js';
import {
  listConversations,
  getConversation,
  replyToConversation,
  markConversationRead,
  drainPendingChats,
} from '../../services/conversationService.js';
import { isHttpDomain } from '../../services/config.js';
import { useConversationUnread } from '../../context/ConversationContext.jsx';

const shareMap = (t) => ({
  phone: { icon: 'phone', text: t('misc.msgSharedContact') },
  docs: { icon: 'file-text', text: t('misc.msgSharedDocument') },
  location: { icon: 'map-pin', text: null },
  visit: { icon: 'calendar-check', text: t('misc.msgProposedVisit') },
});

// Canned openers keep a cold thread moving — the questions buyers actually ask.
const quickReplies = (t) => [
  t('misc.msgQuick1'),
  t('misc.msgQuick2'),
  t('misc.msgQuick3'),
];

export default function Messages() {
  const { t: tr } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { flagEnabled } = useAppFlags();
  const SHARE_MAP = shareMap(tr);
  const QUICK_REPLIES = quickReplies(tr);
  const { refresh: refreshChatBadge } = useConversationUnread();
  /**
   * Demo theatre, mock-only.
   *
   * The canned auto-reply and the typing dots exist so the prototype's threads feel alive with
   * nobody on the other end. Against the API the other end is a real person: fabricating a reply
   * from them would put words in their mouth, and the message would not exist on their device.
   */
  const simulated = !isHttpDomain('conversation');
  const [convs, setConvs] = useState([]);
  const [tab, setTab] = useState('chats');
  const [activeId, setActiveId] = useState(null);
  const [search, setSearch] = useState('');
  const [narrow, setNarrow] = useState(false);
  const [showThread, setShowThread] = useState(false);
  const [typing, setTyping] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const wrapRef = useRef(null);
  const msgsRef = useRef(null);

  const [msgTick, setMsgTick] = useState(0); // triggers scroll on new messages
  /**
   * Optimistic local update.
   *
   * This used to be `saveConversations(next)` — write the whole array to localStorage and re-render
   * from what came back. Against the API there is no "write the whole array": each change is its own
   * request, and awaiting one before repainting puts a round trip between the keystroke and the
   * bubble. So this now updates only what is on screen, and every caller separately fires the one
   * request that corresponds to what the user did.
   */
  const persist = (next) => { setConvs(next); setMsgTick((t) => t + 1); return next; };

  /** Re-read from whichever provider is active, and keep the navbar badge in step. */
  const reload = useCallback(async () => {
    const list = await listConversations().catch(() => []);
    setConvs(list);
    refreshChatBadge();
    return list;
  }, [refreshChatBadge]);

  /* Pull down from the top of the conversation list to re-read the inbox. Bound to the list
     pane rather than to the page: the thread beside it scrolls on its own axis and a pull
     there means "older messages", which is not this gesture. */
  const ptr = usePullToRefresh(reload);

  /**
   * Pull one thread's transcript in.
   *
   * **The inbox does not carry messages.** `ConversationDto.messages` is `NON_NULL` and the
   * contract omits it from the list — a hundred threads would otherwise mean a hundred full
   * transcripts to render a hundred one-line previews. So a row arrives with `messages: []` and
   * the thread has to be read separately, on open, which is also when the user first needs it.
   *
   * The mock returns whole conversations from its single store, so this is a no-op there. That
   * asymmetry is exactly the kind the seam exists to hide: without this the page worked perfectly
   * on mocks and opened an empty thread against the API.
   */
  const hydrate = useCallback((id) => {
    getConversation(id)
      .then((full) => {
        if (!full) return;
        setConvs((cur) => cur.map((c) => (c.id === id ? { ...c, ...full, unread: 0 } : c)));
        setMsgTick((t) => t + 1);
      })
      .catch(() => {});
  }, []);

  const get = (id) => convs.find((c) => c.id === id);
  const active = activeId ? get(activeId) : null;
  // Seed the "already auto-replied" set from persisted flags so a page reload
  // doesn't fire the canned reply again for the same conversation.
  const repliedRef = useRef(new Set());
  const replyTimer = useRef(null);
  useEffect(() => () => { if (replyTimer.current) clearTimeout(replyTimer.current); }, []);

  /**
   * Load the inbox, having first tried to send anything staged.
   *
   * Order matters: a staged chat whose contact gate has since opened becomes a real thread, and
   * draining before reading means it appears once, as itself, rather than twice — once staged and
   * once live.
   */
  useEffect(() => {
    let alive = true;
    drainPendingChats()
      .catch(() => null)
      .then(() => listConversations())
      .then((list) => {
        if (!alive) return;
        setConvs(list);
        list.forEach((c) => { if (c._replied) repliedRef.current.add(c.id); });
        refreshChatBadge();
      })
      .catch(() => { if (alive) setConvs([]); });
    return () => { alive = false; };
  }, [refreshChatBadge]);

  useEffect(() => {
    const onResize = () => setNarrow((wrapRef.current?.clientWidth || 9999) < 720);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => { if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight; }, [active, typing, msgTick]);

  // Click-away-to-close for attach popup
  useEffect(() => {
    if (!attachOpen) return;
    const handleClick = (e) => {
      if (!e.target.closest('.pc-attach-pop') && !e.target.closest('.pc-icon-btn')) setAttachOpen(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [attachOpen]);

  // Mobile: opening a thread pushes a history entry so the hardware/browser back
  // button collapses back to the list instead of leaving the app.
  useEffect(() => {
    const onPop = () => setShowThread(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Auto-open the first active conversation on desktop (matches chat.js init).
  // A `?c=<id>` or `?openProp=<propertyId>` deep-link opens that specific thread on
  // any width — this is how a listing hands the buyer straight into the owner chat.
  //
  // This has to wait for the inbox. `convs` used to be seeded synchronously from localStorage, so
  // a mount-time effect saw the whole list; behind the seam the list arrives from a request, and a
  // mount-time effect sees `[]` and silently opens nothing. So it runs on every `convs` change and
  // latches itself off the first time it has something to look at.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || convs.length === 0) return;
    autoOpened.current = true;
    const params = new URLSearchParams(window.location.search);
    const want = params.get('c');
    const openProp = params.get('openProp');
    const target = (want && convs.find((c) => c.id === want))
      || (openProp && convs.find((c) => c.propertyId === openProp && c.youAre === 'buyer'));
    if (target) { setActiveId(target.id); setShowThread(true); hydrate(target.id); return; }
    const wide = (wrapRef.current?.clientWidth || window.innerWidth) >= 720;
    if (!wide) return;
    const first = convs.find((c) => !c.staged);
    if (first) { setActiveId(first.id); setShowThread(true); hydrate(first.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convs]);

  /* Chats vs Requests is the `staged` flag and nothing else (D52).

     A row is either one the server holds — which means a contact request was approved in one
     direction or the other, because that is the only way a thread comes to exist — or one the seam
     is still holding back until that happens. There is no third condition on the wire, and the
     `incoming` one the prototype invented has been removed rather than given a contract field. */
  const requests = convs.filter((c) => c.staged).length;
  const inTab = (c) => (tab === 'requests' ? !!c.staged : !c.staged);
  const q = search.toLowerCase();
  const items = convs.filter(inTab).filter((c) => !q || c.party.name.toLowerCase().includes(q) || c.property.title.toLowerCase().includes(q));

  const openConv = (id) => {
    // Optimistic: the badge clears on tap, not on the round trip. `markConversationRead` is
    // idempotent on both providers, which is what makes firing it on every open safe.
    persist(convs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    markConversationRead(id).then(refreshChatBadge).catch(() => {});
    hydrate(id);
    setActiveId(id); setAttachOpen(false);
    if ((wrapRef.current?.clientWidth || window.innerWidth) < 720) {
      window.history.pushState({ pcThread: true }, '');
    }
    setShowThread(true);
  };
  const sendText = (raw) => {
    const text = String(raw || '').trim(); if (!text || !active) return;
    const at = Date.now();
    const targetId = activeId;
    // Paint the bubble first; the request follows. A failed send re-reads the thread, so the
    // message disappears rather than sitting there looking delivered.
    persist(convs.map((c) => (c.id === targetId ? { ...c, at, messages: [...c.messages, { from: 'me', text, at, read: false }] } : c)));
    setDraft('');
    replyToConversation(targetId, text)
      .then(refreshChatBadge)
      .catch(() => {
        toast(tr('misc.msgSendFailed'), 'error');
        reload();
      });
    // Auto-reply once per conversation (ref guards against rapid re-sends). Mock-only: see
    // `simulated`. Against the API the reply comes from a person, or it does not come.
    if (simulated && !repliedRef.current.has(targetId)) {
      repliedRef.current.add(targetId);
      setTyping(true);
      replyTimer.current = setTimeout(() => {
        replyTimer.current = null;
        const rAt = Date.now();
        setConvs((cur) => cur.map((c) => (c.id === targetId
          ? { ...c, _replied: true, at: rAt, messages: [...c.messages.map((m) => (m.from === 'me' ? { ...m, read: true } : m)), { from: 'them', text: tr('misc.msgAutoReply'), at: rAt }] }
          : c)));
        setTyping(false);
        setMsgTick((t) => t + 1);
      }, 1400);
    }
  };
  const send = () => sendText(draft);
  const share = (kind) => {
    setAttachOpen(false);
    if (!active) return;
    // "Propose a visit" routes into the real scheduling flow when it's enabled,
    // instead of posting a fake fixed-time card.
    if (kind === 'visit' && flagEnabled('scheduleVisit')) {
      navigate(`/schedule-visit?listing=${active.propertyId}`);
      return;
    }
    const card = SHARE_MAP[kind]; if (!card) return;
    const text = kind === 'location' ? tr('misc.msgSharedLocation') + active.property.loc : card.text;
    const at = Date.now();
    // The wire has no attachment or card type — `MessageCreate` carries `body` alone — so a share
    // chip sends its text and the icon is a local decoration. The recipient sees the sentence,
    // which is the part that carries the meaning.
    persist(convs.map((c) => (c.id === activeId ? { ...c, at, messages: [...c.messages, { from: 'me', type: 'card', icon: card.icon, text, at, read: false }] } : c)));
    replyToConversation(activeId, text).then(refreshChatBadge).catch(() => reload());
  };
  const wrapCls = 'pc-wrap' + (narrow ? ' is-narrow' : '') + (showThread ? ' show-thread' : '');
  // The reveal is a gate read, so it lands after render. It starts closed and only ever opens,
  // which is the safe direction: a thread briefly showing a masked number is a cosmetic delay,
  // whereas defaulting to revealed would flash a number the owner may not have shared.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    let alive = true;
    setRevealed(false);
    canRevealParty(active)
      .then((ok) => alive && setRevealed(ok))
      .catch(() => alive && setRevealed(false));
    return () => { alive = false; };
  }, [active]);
  const partyDigits = active ? digits(active.party?.mobile) : '';
  const showQuick = active && !active.staged && active.youAre === 'buyer' && active.messages.length > 0 && active.messages[active.messages.length - 1].from === 'them';

  return (
    <div className="messages-page pt-2 pb-6">
      <div className="pc-shell max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div ref={wrapRef} className={wrapCls} style={{ height: 'calc(100dvh - 108px)' }}>
          {/* List */}
          <aside className="pc-list relative">
            {(ptr.pullDistance > 0 || ptr.isRefreshing) && (
              <div
                aria-hidden="true"
                className="glass-strong pointer-events-none absolute left-1/2 z-20 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full"
                style={{ top: `${8 + Math.round(ptr.pullDistance)}px`, opacity: 0.4 + ptr.progress * 0.6 }}
              >
                <Icon
                  name={ptr.isRefreshing ? 'loader-2' : 'chevron-down'}
                  className={'w-4 h-4 text-teal-400' + (ptr.isRefreshing ? ' animate-spin' : '')}
                  style={ptr.isRefreshing ? undefined : { transform: `rotate(${ptr.progress * 180}deg)` }}
                />
              </div>
            )}
            <div className="pc-list-head">
              <h2>{tr('misc.msgMessages')}</h2>
              <div className="pc-tabs" role="tablist" aria-label={tr('misc.msgFilters')}>
                <button role="tab" aria-selected={tab === 'chats'} className={'pc-tab' + (tab === 'chats' ? ' active' : '')} onClick={() => setTab('chats')}>{tr('misc.msgChats')}</button>
                <button role="tab" aria-selected={tab === 'requests'} className={'pc-tab' + (tab === 'requests' ? ' active' : '')} onClick={() => setTab('requests')}>{tr('misc.msgRequests')} {requests > 0 && <span className="pc-reqbadge">{requests}</span>}</button>
              </div>
              <div className="pc-search"><Icon name="search" className="w-4 h-4" /><input value={search} onChange={(e) => setSearch(e.target.value)} type="text" enterKeyHint="search" placeholder={tr('misc.msgSearchPlaceholder')} aria-label={tr('misc.msgSearchAria')} /></div>
            </div>
            <div ref={ptr.ref} className="pc-convs">
              {items.length ? items.map((c) => {
                const last = c.messages[c.messages.length - 1];
                const lastText = last ? (last.type === 'card' ? '📎 ' + last.text : (last.from === 'me' ? tr('misc.msgYouPrefix') : '') + last.text) : '';
                return (
                  <button key={c.id} className={'pc-conv' + (c.id === activeId ? ' active' : '')} onClick={() => openConv(c.id)}>
                    <div className="pc-conv-av"><PropertyImage src={c.property.img} alt="" /><span className="pc-conv-badge">{c.party.avatar}</span></div>
                    <div className="pc-conv-main">
                      <div className="pc-conv-top"><span className="pc-conv-name">{c.party.name}</span><span className="pc-conv-time">{relTime(lastAt(c), c.time)}</span></div>
                      <div className="pc-conv-prop">{c.property.title} · {c.property.price}</div>
                      <div className="pc-conv-bot"><span className="pc-conv-last">{lastText}</span>{c.unread ? <span className="pc-unread">{c.unread}</span> : c.staged ? <span className="pc-pill pend">{tr('misc.msgPillPending')}</span> : null}</div>
                    </div>
                  </button>
                );
              }) : <div className="pc-empty-list">{tab === 'requests' ? tr('misc.msgNoRequests') : tr('misc.msgNoChats')}</div>}
            </div>
          </aside>

          {/* Thread */}
          <section className="pc-thread">
            {!active ? (
              <div className="pc-empty">
                <div className="ic"><Icon name="messages-square" className="w-9 h-9 text-teal-400" /></div>
                <h3>{tr('misc.msgEmptyTitle')}</h3>
                <p>{tr('misc.msgEmptyBody')}</p>
              </div>
            ) : (
              <div className="pc-chat">
                <div>
                  <div className="pc-head">
                    <button className="pc-back" onClick={() => { setShowThread(false); if (window.history.state?.pcThread) window.history.back(); }} aria-label={tr('misc.msgBackAria')}><Icon name="arrow-left" className="w-5 h-5" /></button>
                    <div className="pc-head-av"><PropertyImage src={active.property.img} alt="" /><span className={'pc-online' + (active.party.online ? '' : ' off')} /></div>
                    <div className="pc-head-info">
                      <p className="pc-head-name">{active.party.name} <span>· {active.party.role}</span></p>
                      <p className={'pc-head-sub' + (active.party.online ? '' : ' off')}>{active.party.online ? tr('misc.msgOnlineNow') : tr('misc.msgLastSeen')}</p>
                    </div>
                    <div className="pc-head-actions">
                      {revealed && partyDigits ? (
                        <>
                          <a href={`tel:+91${partyDigits}`} className="pc-hbtn" title={tr('misc.msgCallTitle', { phone: fmtPhone(partyDigits) })} aria-label={tr('misc.msgCallAria')}><Icon name="phone" className="w-5 h-5" /></a>
                          <a href={`https://wa.me/91${partyDigits}`} target="_blank" rel="noopener noreferrer" className="pc-hbtn" title={tr('misc.msgWhatsApp')} aria-label={tr('misc.msgWhatsApp')}><Icon name="message-circle" className="w-5 h-5" /></a>
                        </>
                      ) : (
                        <button className="pc-hbtn" disabled title={tr('misc.msgNumberLockedTitle')} aria-label={tr('misc.msgNumberLockedAria')} style={{ opacity: 0.4, cursor: 'not-allowed' }}><Icon name="phone-off" className="w-5 h-5" /></button>
                      )}
                      <button className="pc-hbtn" onClick={() => setReportOpen(true)} title={tr('misc.msgReportUser')} aria-label={tr('misc.msgReportUser')}><Icon name="flag" className="w-5 h-5" /></button>
                    </div>
                  </div>
                  <div className="pc-propchip">
                    <PropertyImage src={active.property.img} alt="" />
                    <div className="t"><p>{active.property.title} · {active.property.price}</p><p><Icon name="map-pin" className="w-3 h-3" style={{ display: 'inline' }} /> {active.property.loc}</p></div>
                    <Link to={`/property/${active.propertyId}`}>{tr('misc.msgViewListing')}</Link>
                  </div>
                </div>

                <div className="pc-msgs" ref={msgsRef} aria-live="polite" aria-relevant="additions">
                  {(() => {
                    let lastDay = null;
                    return active.messages.map((m, i) => {
                      const dl = m.type === 'system' ? null : dayLabel(m.at);
                      const showDay = dl && dl !== lastDay;
                      if (dl) lastDay = dl;
                      return (
                        <Fragment key={i}>
                          {showDay ? <div className="pc-divider">{dl}</div> : null}
                          <MessageBubble m={m} />
                        </Fragment>
                      );
                    });
                  })()}
                  {typing && <TypingDots />}
                </div>

                {active.staged ? (
                  <div className="pc-wait"><Icon name="clock" className="w-4 h-4" /> {tr('misc.msgWaitingOwner')}</div>
                ) : (
                  <>
                    {showQuick ? (
                      <div className="pc-quick">
                        {QUICK_REPLIES.map((qr) => (
                          <button key={qr} className="pc-quick-chip" onClick={() => sendText(qr)}>{qr}</button>
                        ))}
                      </div>
                    ) : null}
                    <div className="pc-composer">
                      {attachOpen && (
                        <div className="pc-attach-pop">
                          <button onClick={() => share('phone')}><Icon name="phone" className="w-4 h-4" style={{ color: '#2dd4bf' }} /> {tr('misc.msgShareContact')}</button>
                          <button onClick={() => share('docs')}><Icon name="file-text" className="w-4 h-4" style={{ color: '#818cf8' }} /> {tr('misc.msgShareDocuments')}</button>
                          <button onClick={() => share('location')}><Icon name="map-pin" className="w-4 h-4" style={{ color: '#fb7185' }} /> {tr('misc.msgShareLocation')}</button>
                          <button onClick={() => share('visit')}><Icon name="calendar-check" className="w-4 h-4" style={{ color: '#34d399' }} /> {tr('misc.msgProposeVisit')}</button>
                        </div>
                      )}
                      <button className="pc-icon-btn" onClick={() => setAttachOpen((v) => !v)} aria-label={tr('misc.msgShareAttachment')}><Icon name="plus" className="w-5 h-5" /></button>
                      <input className="pc-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} type="text" enterKeyHint="send" placeholder={tr('misc.msgTypeMessage')} aria-label={tr('misc.msgTypeMessage')} />
                      <button className="pc-send" onClick={send} aria-label={tr('misc.msgSendMessage')}><Icon name="send" className="w-5 h-5" /></button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
      {reportOpen && active ? (
        <SharedReportModal
          kind="user"
          reasons={OWNER_REPORT_REASONS}
          title={tr('misc.msgReportTitle', { name: active.party.name })}
          subtitle={tr('misc.msgReportSubtitle')}
          success={tr('misc.msgReportSuccess')}
          target={{ id: active.propertyId, title: active.property.title, ownerName: active.party.name, ownerMobile: active.party.mobile }}
          onClose={() => setReportOpen(false)}
          toast={toast}
        />
      ) : null}
    </div>
  );
}
