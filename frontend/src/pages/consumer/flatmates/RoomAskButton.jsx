import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { openFlatmateRequestConversation } from '../../../services/conversationService.js';

export default function RoomAskButton({ ask, onAsk, className }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { flagEnabled } = useAppFlags();
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold ' + className;

  if (ask?.status === 'accepted' && flagEnabled('inAppMessaging')) {
    const openChat = async () => {
      try {
        const conv = await openFlatmateRequestConversation(ask.id);
        navigate(`/messages?c=${encodeURIComponent(conv.id)}`);
      } catch (err) {
        toast(err?.message || t('common.somethingWentWrong'), 'error');
      }
    };
    return <button type="button" onClick={openChat} data-testid="room-chat-owner" className={'room-exp-btn btn-teal text-white ' + base}><Icon name="message-circle" className="w-4 h-4 shrink-0" /> <span className="truncate">{t('flatmates.messageOwner')}</span></button>;
  }
  if (ask) {
    return <button type="button" className={'btn-ghost text-emerald-300 cursor-default ' + base} disabled><Icon name="check-check" className="w-4 h-4 shrink-0" /> <span className="truncate">{t('flatmates.interestSent')}</span></button>;
  }
  return <button type="button" onClick={onAsk} className={'room-exp-btn btn-teal text-white ' + base}><Icon name="hand-heart" className="w-4 h-4 shrink-0" /> <span className="truncate">{t('flatmates.sendInterest')}</span></button>;
}
