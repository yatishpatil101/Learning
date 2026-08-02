import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import '../../styles/routes/messages.css';
import { MessageBubble, TypingDots } from '../../components/chat/ChatPrimitives.jsx';
import SharedReportModal, { OWNER_REPORT_REASONS } from '../../components/ReportModal.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { digits, fmtPhone } from '../../lib/contact.js';
import {
  loadConversations, saveConversations, readConversations,
  dayLabel, relTime, canRevealParty, lastAt,
} from '../../lib/chat.js';

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
  const [convs, setConvs] = useState(loadConversations);
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
  const persist = (next) => { const saved = saveConversations(next); setConvs(saved); setMsgTick((t) => t + 1); return saved; };
  const get = (id) => convs.find((c) => c.id === id);
  const active = activeId ? get(activeId) : null;
  // Seed the "already auto-replied" set from persisted flags so a page reload
  // doesn't fire the canned reply again for the same conversation.
  const repliedRef = useRef(new Set());
  const replyTimer = useRef(null);
  useEffect(() => () => { if (replyTimer.current) clearTimeout(replyTimer.current); }, []);
  useEffect(() => { readConversations().forEach((c) => { if (c._replied) repliedRef.current.add(c.id); }); }, []);

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
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const want = params.get('c');
    const openProp = params.get('openProp');
    const target = (want && convs.find((c) => c.id === want))
      || (openProp && convs.find((c) => c.propertyId === openProp && c.youAre === 'buyer'));
    if (target) { setActiveId(target.id); setShowThread(true); return; }
    const wide = (wrapRef.current?.clientWidth || window.innerWidth) >= 720;
    if (!wide) return;
    const first = convs.find((c) => c.state === 'active');
    if (first) { setActiveId(first.id); setShowThread(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const incoming = convs.filter((c) => c.state === 'incoming').length;
  const inTab = (c) => (tab === 'requests' ? c.state === 'incoming' || c.state === 'pending' : c.state === 'active');
  const q = search.toLowerCase();
  const items = convs.filter(inTab).filter((c) => !q || c.party.name.toLowerCase().includes(q) || c.property.title.toLowerCase().includes(q));

  const openConv = (id) => {
    const next = convs.map((c) => (c.id === id ? { ...c, unread: 0 } : c));
    persist(next); setActiveId(id); setAttachOpen(false);
    if ((wrapRef.current?.clientWidth || window.innerWidth) < 720) {
      window.history.pushState({ pcThread: true }, '');
    }
    setShowThread(true);
  };
  const sendText = (raw) => {
    const text = String(raw || '').trim(); if (!text || !active) return;
    const at = Date.now();
    const targetId = activeId;
    persist(convs.map((c) => (c.id === targetId ? { ...c, at, messages: [...c.messages, { from: 'me', text, at, read: false }] } : c)));
    setDraft('');
    // Auto-reply once per conversation (ref guards against rapid re-sends).
    if (!repliedRef.current.has(targetId)) {
      repliedRef.current.add(targetId);
      setTyping(true);
      replyTimer.current = setTimeout(() => {
        replyTimer.current = null;
        const rAt = Date.now();
        setConvs((cur) => saveConversations(cur.map((c) => (c.id === targetId
          ? { ...c, _replied: true, at: rAt, messages: [...c.messages.map((m) => (m.from === 'me' ? { ...m, read: true } : m)), { from: 'them', text: tr('misc.msgAutoReply'), at: rAt }] }
          : c))));
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
    persist(convs.map((c) => (c.id === activeId ? { ...c, at, messages: [...c.messages, { from: 'me', type: 'card', icon: card.icon, text, at, read: false }] } : c)));
  };
  const accept = (id) => { persist(convs.map((c) => (c.id === id ? { ...c, state: 'active', at: Date.now(), messages: [...c.messages, { type: 'system', text: tr('misc.msgAcceptedSystem') }] } : c))); setTab('chats'); };
  const decline = (id) => { persist(convs.filter((c) => c.id !== id)); setActiveId(null); setShowThread(false); };

  const wrapCls = 'pc-wrap' + (narrow ? ' is-narrow' : '') + (showThread ? ' show-thread' : '');
  const revealed = canRevealParty(active);
  const partyDigits = active ? digits(active.party?.mobile) : '';
  const showQuick = active && active.state === 'active' && active.youAre === 'buyer' && active.messages.length > 0 && active.messages[active.messages.length - 1].from === 'them';

  return (
    <div className="messages-page pt-2 pb-6">
      <div className="pc-shell max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div ref={wrapRef} className={wrapCls} style={{ height: 'calc(100dvh - 108px)' }}>
          {/* List */}
          <aside className="pc-list">
            <div className="pc-list-head">
              <h2>{tr('misc.msgMessages')}</h2>
              <div className="pc-tabs" role="tablist" aria-label={tr('misc.msgFilters')}>
                <button role="tab" aria-selected={tab === 'chats'} className={'pc-tab' + (tab === 'chats' ? ' active' : '')} onClick={() => setTab('chats')}>{tr('misc.msgChats')}</button>
                <button role="tab" aria-selected={tab === 'requests'} className={'pc-tab' + (tab === 'requests' ? ' active' : '')} onClick={() => setTab('requests')}>{tr('misc.msgRequests')} {incoming > 0 && <span className="pc-reqbadge">{incoming}</span>}</button>
              </div>
              <div className="pc-search"><Icon name="search" className="w-4 h-4" /><input value={search} onChange={(e) => setSearch(e.target.value)} type="text" enterKeyHint="search" placeholder={tr('misc.msgSearchPlaceholder')} aria-label={tr('misc.msgSearchAria')} /></div>
            </div>
            <div className="pc-convs">
              {items.length ? items.map((c) => {
                const last = c.messages[c.messages.length - 1];
                const lastText = last ? (last.type === 'card' ? '📎 ' + last.text : (last.from === 'me' ? tr('misc.msgYouPrefix') : '') + last.text) : '';
                return (
                  <button key={c.id} className={'pc-conv' + (c.id === activeId ? ' active' : '')} onClick={() => openConv(c.id)}>
                    <div className="pc-conv-av"><img src={c.property.img} alt="" /><span className="pc-conv-badge">{c.party.avatar}</span></div>
                    <div className="pc-conv-main">
                      <div className="pc-conv-top"><span className="pc-conv-name">{c.party.name}</span><span className="pc-conv-time">{relTime(lastAt(c), c.time)}</span></div>
                      <div className="pc-conv-prop">{c.property.title} · {c.property.price}</div>
                      <div className="pc-conv-bot"><span className="pc-conv-last">{lastText}</span>{c.unread ? <span className="pc-unread">{c.unread}</span> : c.state === 'incoming' ? <span className="pc-pill req">{tr('misc.msgPillRequest')}</span> : c.state === 'pending' ? <span className="pc-pill pend">{tr('misc.msgPillPending')}</span> : null}</div>
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
                    <div className="pc-head-av"><img src={active.property.img} alt="" /><span className={'pc-online' + (active.party.online ? '' : ' off')} /></div>
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
                    <img src={active.property.img} alt="" />
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

                {active.state === 'incoming' ? (
                  <div className="pc-actions">
                    <p><b style={{ color: '#fff' }}>{active.party.name}</b>{tr('misc.msgWantsToChat')}</p>
                    <p className="sub">{tr('misc.msgAcceptSub')}</p>
                    <div className="btns">
                      <button className="pc-btn" onClick={() => decline(active.id)}>{tr('misc.msgDecline')}</button>
                      <button className="pc-btn primary" onClick={() => accept(active.id)}><Icon name="check" className="w-4 h-4" /> {tr('misc.msgAcceptChat')}</button>
                    </div>
                  </div>
                ) : active.state === 'pending' ? (
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
