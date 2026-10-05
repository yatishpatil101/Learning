import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { formatTime } from '../../lib/chatFormat.js';

/* Shared presentational pieces for the buyer↔owner chat thread. */
export function MessageBubble({ m, author = null, grouped = false, onAction, onRetry }) {
  const timer = useRef(null);
  const [lightbox, setLightbox] = useState(null);
  const photo = m.attachments?.find((a) => String(a.contentType || '').startsWith('image/')) || null;
  const closeLightbox = () => {
    if (window.history.state?.pcLightbox) window.history.back();
    else setLightbox(null);
  };
  useEffect(() => {
    if (!lightbox) return undefined;
    window.history.replaceState({ ...(window.history.state || {}), pcThread: true }, '');
    window.history.pushState({ ...(window.history.state || {}), pcLightbox: true }, '');
    const key = (event) => { if (event.key === 'Escape') closeLightbox(); };
    const pop = () => setLightbox(null);
    window.addEventListener('keydown', key);
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('popstate', pop);
    };
  }, [lightbox]);
  if (m.type === 'system') return <div className="pc-sys">{m.text}</div>;
  const tickIcon = m.failed ? 'circle-alert' : m.pending ? 'clock' : m.read ? 'check-check' : m.delivered ? 'check-check' : 'check';
  const tick = m.from === 'me' ? (
    <span className={'tick ' + (m.read ? 'read' : m.delivered ? 'delivered' : m.pending ? 'pending' : 'sent')}>
      <Icon name={tickIcon} className="w-3.5 h-3.5" />
    </span>
  ) : null;
  const start = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onAction?.(m), 480);
  };
  const stop = () => clearTimeout(timer.current);
  return (
    <div className={'pc-row ' + m.from + (grouped ? ' grouped' : '')}>
      <div
        className={'pc-bubble ' + m.from + (grouped ? ' grouped' : '') + (m.failed ? ' failed' : '')}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => { e.preventDefault(); onAction?.(m); }}
      >
        <button type="button" className="pc-msg-more" onClick={() => onAction?.(m)} aria-label="Message actions"><Icon name="more-horizontal" className="w-4 h-4" /></button>
        {author && <div className="text-[11px] font-semibold text-teal-300 mb-0.5" data-testid="chat-author">{author}</div>}
        {m.replyTo ? <div className="pc-quote">{m.replyTo.body || m.replyTo.text}</div> : null}
        {photo ? (
          <button type="button" className="pc-photo-bubble" onClick={() => setLightbox(photo)} aria-label="Open photo">
            <img src={photo.url} alt="" loading="lazy" />
          </button>
        ) : null}
        {m.type === 'card'
          ? <div className="pc-card"><span className="ci"><Icon name={m.icon || 'paperclip'} className="w-4 h-4" /></span><span>{m.text}</span></div>
          : m.text ? <div className={photo ? 'pc-caption' : undefined}>{m.text}</div> : null}
        <div className="pc-meta">{formatTime(m.at, m.time || '')}{tick}</div>
        {m.failed ? <button type="button" className="pc-retry" onClick={onRetry}>Not sent · Tap to retry</button> : null}
      </div>
      {lightbox ? (
        <div className="pc-lightbox" role="dialog" aria-modal="true" aria-label="Photo preview" onClick={closeLightbox}>
          <button type="button" className="pc-light-close" onClick={(event) => { event.stopPropagation(); closeLightbox(); }} aria-label="Close preview"><Icon name="x" className="w-5 h-5" /></button>
          <img src={lightbox.url} alt="" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </div>
  );
}

export function TypingDots() {
  const { t } = useTranslation();
  return <div className="pc-typing" aria-label={t('misc.msgTyping')}><span /><span /><span /></div>;
}
