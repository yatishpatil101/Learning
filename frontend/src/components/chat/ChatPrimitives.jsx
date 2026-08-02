import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { formatTime } from '../../lib/chat.js';

/* Shared presentational pieces for the buyer↔owner chat thread. Kept dumb so the
   inbox owns all state; extracted here so the thread markup lives in one place. */

export function MessageBubble({ m }) {
  if (m.type === 'system') return <div className="pc-sys">{m.text}</div>;
  const tick = m.from === 'me' ? (
    <span className="tick">
      <Icon name={m.read ? 'check-check' : 'check'} className="w-3.5 h-3.5" style={{ color: m.read ? '#5eead4' : 'currentColor' }} />
    </span>
  ) : null;
  return (
    <div className={'pc-row ' + m.from}>
      <div className={'pc-bubble ' + m.from}>
        {m.type === 'card'
          ? <div className="pc-card"><span className="ci"><Icon name={m.icon || 'paperclip'} className="w-4 h-4" /></span><span>{m.text}</span></div>
          : m.text}
        <div className="pc-meta">{formatTime(m.at, m.time || '')}{tick}</div>
      </div>
    </div>
  );
}

export function TypingDots() {
  const { t } = useTranslation();
  return <div className="pc-typing" aria-label={t('nestor.typing')}><span /><span /><span /></div>;
}
