import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { dayLabel } from '../../../lib/chatFormat.js';
import { MessageBubble, TypingDots } from '../../../components/chat/ChatPrimitives.jsx';
import ActionSheet from './ActionSheet.jsx';

export default function MessageList({ t, active, typing, onReply, onDelete, onRetry }) {
  const ref = useRef(null);
  const [up, setUp] = useState(false);
  const [sheet, setSheet] = useState(null);
  const firstUnread = active.unread ? Math.max(0, active.messages.length - active.unread) : -1;
  const newCount = up ? active.messages.filter((m) => m.from === 'them').slice(-Math.max(1, active.unread || 0)).length : 0;

  const items = useMemo(() => active.messages.map((m, i, arr) => {
    const next = arr[i + 1];
    const tail = !next || next.from !== m.from || Math.abs((next.at || 0) - (m.at || 0)) > 180000;
    return { ...m, tail };
  }), [active.messages]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    const last = active.messages.at(-1);
    if (nearBottom || last?.from === 'me') requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [active.messages, active.id, typing]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setUp(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
  };
  const jump = () => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
    setUp(false);
  };

  let lastDay = null;
  return (
    <div className="pc-msg-wrap">
      <div className="pc-msgs" ref={ref} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
        {items.map((m, i) => {
          const dl = m.type === 'system' ? null : dayLabel(m.at);
          const showDay = dl && dl !== lastDay;
          if (dl) lastDay = dl;
          return (
            <Fragment key={m.id || m.clientId}>
              {showDay ? <div className="pc-divider">{dl}</div> : null}
              {i === firstUnread ? <div className="pc-new-divider">New messages</div> : null}
              <MessageBubble m={m} author={active.group && m.from === 'them' ? m.author || t('misc.msgGroupMember') : null} grouped={!m.tail} onAction={setSheet} onRetry={() => onRetry(m)} />
            </Fragment>
          );
        })}
        {typing ? <TypingDots /> : null}
      </div>
      {up ? <button type="button" className="pc-jump" onClick={jump}>Jump to latest{newCount ? ` · ${newCount}` : ''}</button> : null}
      {sheet ? <ActionSheet title="Message" onClose={() => setSheet(null)} actions={[
        { label: 'Reply', icon: 'reply', onClick: () => onReply(sheet) },
        { label: 'Copy', icon: 'copy', onClick: () => navigator.clipboard?.writeText(sheet.text || '') },
        sheet.id && !String(sheet.id).startsWith('client:') && { label: 'Delete for me', icon: 'trash-2', danger: true, onClick: () => onDelete(sheet.id) },
      ]} /> : null}
    </div>
  );
}
