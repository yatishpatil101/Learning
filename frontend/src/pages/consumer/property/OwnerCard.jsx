import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import { digits, maskPhone } from '../../../lib/contact.js';
import { messagesLinkForProp } from '../../../lib/chatFormat.js';
import { queuePendingChat } from '../../../services/conversationService.js';
import { ContactBox } from './ContactBox.jsx';
import { whatsappHref } from './contactPhone.js';
import { ownerVerificationMeta, OwnerRoleLine, OwnerVerifiedMark } from './ownerVerification.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';

const BEST_TIME_KEYS = new Set(['anytime', 'morning', 'afternoon', 'evening']);

/* `ownerHidesNumber` arrives as a prop, from the same gate answer that produced `contactApproved`, so the WhatsApp
   button and the number reveal decide from one value. */
export function OwnerCard({ p, isIn, toast, contactApproved, ownerHidesNumber = false, ownerMob, onContact, canChat }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { identityVerified, anyVerified, roleAndVerification } = ownerVerificationMeta(p, t);
  const waHref = whatsappHref(ownerMob, `Hi, I'm interested in your property "${p.title}" listed on Draazy. Is it still available?`);
  const isOwnerViewer = isIn && digits(ownerMob) && digits(ownerMob) === digits(user?.mobile);
  const openChat = async (event) => {
    event.preventDefault();
    await queuePendingChat(p, { active: true });
    navigate(messagesLinkForProp(p));
  };
  return (
    <div className="glass-strong rounded-2xl p-5">
      <Tip k="owner.noBrokerage">
        <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <Icon name="hand-coins" className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-emerald-300 font-medium">{t('property.noBrokerageDeal')}</span>
        </div>
      </Tip>
      <Link to={`/owner/${p.ownerId}`} className="flex items-center gap-3 mb-3 group">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-teal-1 to-brand-indigo-4 flex items-center justify-center text-white font-bold text-lg">{(p.owner || 'A')[0]}</div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-white group-hover:text-brand-teal-3 transition-smooth">{p.owner}</span>
            <OwnerVerifiedMark anyVerified={anyVerified} />
          </div>
          <OwnerRoleLine anyVerified={anyVerified} roleAndVerification={roleAndVerification} ownerLabel={t('listings.owner')} />
        </div>
      </Link>
      {isIn ? (
        <ContactBox p={p} isIn={isIn} toast={toast} />
      ) : (
        <div className="mb-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Icon name="phone-off" className="w-4 h-4 text-slate-500" />
            <span className="tracking-wider">{maskPhone(ownerMob)}</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{t('property.hiddenPrivacy')}</p>
          <button type="button" onClick={onContact} className="btn-teal mt-2 w-full min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold py-2 px-3 shadow-none">
            <Icon name="lock-keyhole" className="w-3.5 h-3.5" /> {t('property.requestNumber')}
          </button>
        </div>
      )}
      {BEST_TIME_KEYS.has(p.bestTimeToCall) && (
        <div className="mb-3 flex items-center gap-1.5 text-xs text-slate-300" data-testid="best-time-to-call">
          <Icon name="clock" className="w-3.5 h-3.5 text-slate-400" /> {t('property.bestTimeToCall', { time: t(`property.bestTime.${p.bestTimeToCall}`) })}
        </div>
      )}

      {/* A claim about how fast a *person* replies, so it hangs on the person's badge alone. */}
      {identityVerified && (
        <div className="mb-3 -mt-1 flex items-center gap-1.5 text-[11px] text-emerald-300/90">
          <Icon name="zap" className="w-3.5 h-3.5" /> {t('property.verifiedRespondsFaster')}
        </div>
      )}
      <div className="flex gap-2">
        {isOwnerViewer ? (
          <div className="hidden lg:flex flex-1">
            <button type="button" onClick={() => navigate('/dashboard?tab=listings')} className="w-full flex items-center justify-center gap-1.5 rounded-lg btn-teal text-xs font-semibold py-2 px-3 shadow-none"><Icon name="layout-dashboard" className="w-3.5 h-3.5" /> {t('property.manageListing')}</button>
          </div>
        ) : contactApproved && canChat ? (
          <div className="hidden lg:flex flex-1">
            <Link to={messagesLinkForProp(p)} onClick={openChat} className="w-full flex items-center justify-center gap-1.5 rounded-lg btn-teal text-xs font-semibold py-2 px-3 shadow-none"><Icon name="message-circle" className="w-3.5 h-3.5" /> {t('property.chatWithOwner')}</Link>
          </div>
        ) : (
          <div className="hidden lg:flex flex-1">
            <button onClick={onContact} className="w-full flex items-center justify-center gap-1.5 rounded-lg btn-teal text-xs font-semibold py-2 px-3 shadow-none"><Icon name="message-circle" className="w-3.5 h-3.5" /> {t('property.contactOwner')}</button>
          </div>
        )}
        <Link to={`/owner/${p.ownerId}`} className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] py-2 sm:min-h-0 rounded-lg border border-white/10 text-slate-300 text-[13px] sm:text-xs font-medium hover:bg-white/5 transition-smooth"><Icon name="user" className="w-3.5 h-3.5" /> {t('property.profile')}</Link>
      </div>
      {!isOwnerViewer && contactApproved && !ownerHidesNumber && waHref && (
        <a href={waHref} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 min-h-[44px] py-2.5 sm:min-h-0 text-sm font-semibold text-white hover:bg-emerald-500 transition">
          <Icon name="message-circle" className="w-4 h-4" /> {t('property.chatOnWhatsapp')}
        </a>
      )}
      <Link to="/tenant-profile" className="mt-3 flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 text-[13px] sm:text-[11px] text-emerald-300 hover:text-emerald-200"><Icon name="user-check" className="w-3.5 h-3.5" /> {t('property.verifiedTenantBadge')}</Link>
    </div>
  );
}
