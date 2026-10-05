import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import PropertyImage from '../../../components/ui/PropertyImage.jsx';
import { digits, fmtPhone, isFullMobile } from '../../../lib/contact.js';
import { formatTime } from '../../../lib/chatFormat.js';
import { detailPath } from '../flatmates/helpers.js';
import { ThreadAvatar } from './Inbox.jsx';
import MessageList from './MessageList.jsx';

const listingLine = (property) => [property?.bhk, property?.loc].filter(Boolean).join(' · ');
const quickReplies = (property) => [
  'Is it still available?',
  'Can I visit this Saturday?',
  property?.deal === 'sale' ? "What's the final price?" : "What's the final rent?",
];
const draftKey = (userId, threadId) => `dzMsgDraft:${userId || 'anon'}:${threadId}`;
const finePointer = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
const hasPrivateContact = (text) =>
  /(^|[^\d])(?:\+?91[\s.-]*|0[\s.-]*)?[6-9](?:[\s.-]*\d){9}(?![\s.-]*\d)/.test(text)
  || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text);
const PHOTO_TYPES = ['image/jpeg', 'image/png'];
const PHOTO_MAX = 8_000_000;

function subtitleOf(active, typing, t) {
  if (active.group) return t('misc.msgGroupMembers', { count: active.group.memberCount });
  if (typing) return t('misc.msgTyping');
  if (!active.presence) return '';
  if (active.presence.online) return t('misc.msgOnline');
  if (!active.presence.lastSeenAt) return '';
  const at = active.presence.lastSeenAt;
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? t('misc.msgLastSeenToday', { time: formatTime(at) })
    : t('misc.msgLastSeenDate', { date: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) });
}

export default function Thread({
  t,
  active,
  onBack,
  onSend,
  onPhoto,
  onPhotoError,
  onTyping,
  typing,
  onDelete,
  onState,
  onBlock,
  onReport,
  userId,
  offline,
  sendError,
}) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const lastTyping = useRef(0);
  const previewRef = useRef(null);
  const mobile = active?.party?.mobile || '';
  const canCall = isFullMobile(mobile);
  const partyDigits = digits(mobile);
  const key = active ? draftKey(userId, active.id) : '';
  const showQuick = active && !active.staged && !active.blocked && (!active.messages.length || active.messages.at(-1)?.from === 'them');
  const showPrivacyHint = draft && !canCall && hasPrivateContact(draft);
  const replies = useMemo(() => quickReplies(active?.property).slice(0, 3), [active?.property]);
  const previewOpen = !!preview;

  useEffect(() => {
    if (!key) return;
    setDraft(sessionStorage.getItem(key) || '');
    setReplyTo(null);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    if (draft) sessionStorage.setItem(key, draft);
    else sessionStorage.removeItem(key);
  }, [draft, key]);

  const resize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };
  useEffect(resize, [draft]);

  const changeDraft = (value) => {
    setDraft(value);
    if (!value.trim() || !active || active.staged || active.blocked) return;
    const now = Date.now();
    if (now - lastTyping.current < 3000) return;
    lastTyping.current = now;
    onTyping?.(active.id);
  };

  useEffect(() => { previewRef.current = preview; }, [preview]);

  useEffect(() => () => {
    if (previewRef.current?.url) URL.revokeObjectURL(previewRef.current.url);
  }, []);

  const disposePreview = () => {
    const p = previewRef.current;
    if (p?.url) URL.revokeObjectURL(p.url);
    previewRef.current = null;
    setPreview(null);
  };

  const closePreview = () => {
    if (window.history.state?.pcPhotoPreview) window.history.back();
    else disposePreview();
  };

  useEffect(() => {
    if (!previewOpen) return undefined;
    window.history.replaceState({ ...(window.history.state || {}), pcThread: true }, '');
    window.history.pushState({ ...(window.history.state || {}), pcPhotoPreview: true }, '');
    const key = (event) => { if (event.key === 'Escape') closePreview(); };
    window.addEventListener('popstate', disposePreview);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('popstate', disposePreview);
      window.removeEventListener('keydown', key);
    };
  }, [previewOpen]);

  if (!active) {
    return (
      <section className="pc-thread">
        <div className="pc-empty"><div className="ic"><Icon name="messages-square" className="w-9 h-9 text-teal-400" /></div><h3>{t('misc.msgEmptyTitle')}</h3><p>{t('misc.msgEmptyBody')}</p></div>
      </section>
    );
  }

  const send = (text = draft, retry) => {
    const body = String(text || '').trim();
    if (!body) return;
    onSend(body, retry ? null : replyTo, retry?.clientId);
    if (!retry) {
      setDraft('');
      setReplyTo(null);
      sessionStorage.removeItem(key);
    }
  };

  const pickPhoto = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type) || file.size > PHOTO_MAX) {
      onPhotoError?.(t('misc.msgPhotoRejected'));
      return;
    }
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview({ file, url: URL.createObjectURL(file), caption: '' });
  };

  const sendPreview = () => {
    const current = preview;
    if (!current) return;
    onPhoto?.({ file: current.file, caption: current.caption, previewUrl: current.url });
    previewRef.current = null;
    setPreview(null);
    if (window.history.state?.pcPhotoPreview) window.history.back();
  };

  const subtitle = subtitleOf(active, typing, t);

  return (
    <section className="pc-thread">
      <div className="pc-chat">
        <div className="pc-sticky-top">
          <div className="pc-head">
            <button className="pc-back" onClick={onBack} aria-label={t('misc.msgBackAria')}><Icon name="arrow-left" className="w-5 h-5" /></button>
            <div className="pc-head-av"><ThreadAvatar c={active} /></div>
            <div className="pc-head-info">
              <p className="pc-head-name">{active.party.name}</p>
              {subtitle ? <p className={'pc-head-sub' + (active.presence?.online || typing ? '' : ' off')}>{subtitle}</p> : null}
            </div>
            {active.group ? (
              <Link to={detailPath('group', active.group.id)} className="pc-hbtn" title={t('misc.msgViewGroup')} aria-label={t('misc.msgViewGroup')} data-testid="chat-view-group"><Icon name="users-round" className="w-5 h-5" /></Link>
            ) : (
              <div className="pc-head-actions">
                {canCall ? <><a href={`tel:+91${partyDigits}`} className="pc-hbtn" title={t('misc.msgCallTitle', { phone: fmtPhone(partyDigits) })} aria-label={t('misc.msgCallAria')}><Icon name="phone" className="w-5 h-5" /></a><a href={`https://wa.me/91${partyDigits}`} target="_blank" rel="noopener noreferrer" className="pc-hbtn" title={t('misc.msgWhatsApp')} aria-label={t('misc.msgWhatsApp')}><Icon name="message-circle" className="w-5 h-5" /></a></> : <button className="pc-hbtn" disabled title={t('misc.msgNumberLockedTitle')} aria-label={t('misc.msgNumberLockedAria')}><Icon name="phone-off" className="w-5 h-5" /></button>}
                <button className="pc-hbtn" onClick={() => setMenu((v) => !v)} aria-label="Conversation actions"><Icon name="more-vertical" className="w-5 h-5" /></button>
                {menu ? <div className="pc-menu"><Link to={`/property/${active.propertyId}`}>View listing</Link><button onClick={() => { setMenu(false); onState(active.id, { archived: !active.archived }); }}>{active.archived ? 'Unarchive' : 'Archive'}</button><button onClick={() => { setMenu(false); onState(active.id, { muted: !active.muted }); }}>{active.muted ? 'Unmute' : 'Mute'}</button><button onClick={() => { setMenu(false); onBlock(active.id, !active.blocked); }}>{active.blocked ? 'Unblock' : 'Block'}</button><button aria-label="Report this user" onClick={() => { setMenu(false); onReport(); }}>Report this user</button></div> : null}
              </div>
            )}
          </div>
          {!active.group && active.propertyId ? <div className={'pc-propchip' + (active.property?.available === false ? ' unavailable' : '')}>
            {active.property?.available === false ? <div className="pc-prop-empty"><Icon name="home" className="w-5 h-5" /></div> : <PropertyImage src={active.property.img} alt="" />}
            <div className="t"><p>{active.property.title}</p><p>{active.property?.available === false ? 'No longer listed' : [active.property.price, listingLine(active.property)].filter(Boolean).join(' · ')}</p></div>
            {active.property?.available !== false ? <button type="button" onClick={() => navigate(`/schedule-visit?listing=${active.propertyId}`)}>Schedule visit</button> : null}
            <Link to={`/property/${active.propertyId}`}>{t('misc.msgViewListing')}</Link>
          </div> : null}
        </div>

        <MessageList
          t={t}
          active={active}
          typing={typing}
          onReply={setReplyTo}
          onDelete={(mid) => onDelete(active.id, mid)}
          onRetry={(m) => (m.attachments?.length ? onPhoto?.({ file: m.photoFile, caption: m.text, retry: m }) : send(m.text, m))}
        />
        {offline ? <div className="pc-offline">You're offline ? messages send when you're back</div> : null}
        {active.staged ? <div className="pc-wait"><Icon name="clock" className="w-4 h-4" /> {t('misc.msgWaitingOwner')}</div> : active.blocked ? (
          <div className="pc-wait"><Icon name="ban" className="w-4 h-4" /> You blocked {active.party.name} ? <button type="button" onClick={() => onBlock(active.id, false)}>Unblock</button></div>
        ) : (
          <>
            {showQuick ? <div className="pc-quick">{replies.map((qr) => <button key={qr} className="pc-quick-chip" onClick={() => send(qr)}>{qr}</button>)}</div> : null}
            {showPrivacyHint ? <div className="pc-privacy-hint">{t('misc.msgPrivateContactHint')}</div> : null}
            <div className="pc-composer">
              {replyTo ? <div className="pc-reply-bar"><span>{replyTo.text}</span><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Icon name="x" className="w-4 h-4" /></button></div> : null}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={pickPhoto} />
              <button type="button" className="pc-icon-btn pc-attach" onClick={() => fileRef.current?.click()} aria-label={t('misc.msgAttachPhoto')}><Icon name="paperclip" className="w-5 h-5" /></button>
              <textarea ref={inputRef} className="pc-input" value={draft} onChange={(e) => changeDraft(e.target.value)} onInput={resize} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && finePointer()) { e.preventDefault(); send(); } }} rows={1} enterKeyHint="send" placeholder={t('misc.msgTypeMessage')} aria-label={t('misc.msgTypeMessage')} />
              <button className="pc-send" disabled={!draft.trim()} onClick={() => send()} aria-label={t('misc.msgSendMessage')}><Icon name="send" className="w-5 h-5" /></button>
              {sendError ? <div className="pc-send-error">{sendError}</div> : null}
            </div>
            {preview ? (
              <div className="pc-photo-preview" role="dialog" aria-modal="true" aria-label={t('misc.msgPhotoPreview')}>
                <div className="pc-photo-panel">
                  <button type="button" className="pc-light-close" onClick={closePreview} aria-label={t('misc.msgClosePreview')}><Icon name="x" className="w-5 h-5" /></button>
                  <img src={preview.url} alt="" />
                  <textarea value={preview.caption} onChange={(e) => setPreview((p) => ({ ...p, caption: e.target.value }))} maxLength={1000} rows={2} placeholder={t('misc.msgPhotoCaption')} />
                  <button type="button" className="pc-photo-send" onClick={sendPreview}>{t('misc.msgSendPhoto')}</button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
