import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { useAppFlags } from '../../../../context/AppFlagsContext.jsx';
import { openGroupConversation } from '../../../../services/conversationService.js';

export default function GroupChatLink({ groupId }) {
  const { t } = useTranslation();
  const { flagEnabled } = useAppFlags();
  const enabled = flagEnabled('inAppMessaging');
  const [conv, setConv] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    openGroupConversation(groupId).then((c) => alive && setConv(c)).catch(() => {});
    return () => { alive = false; };
  }, [groupId, enabled]);

  if (!conv) return null;
  return (
    <Link to={`/messages?c=${encodeURIComponent(conv.id)}`} data-testid="group-chat-link"
      className="flex items-center gap-3 min-h-[52px] px-4 rounded-2xl bg-teal-500/10 ring-1 ring-teal-400/30 text-teal-100 hover:bg-teal-500/15 transition">
      <Icon name="message-circle" className="w-5 h-5 text-teal-300" />
      <span className="flex-1 text-sm font-semibold">{t('flatmates.groupChat')}</span>
      {conv.unread > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-teal-500 text-white text-[11px] font-bold inline-flex items-center justify-center" data-testid="group-chat-unread">{conv.unread}</span>}
      <Icon name="chevron-right" className="w-4 h-4 text-teal-300/70" />
    </Link>
  );
}
