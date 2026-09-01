import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import { digits } from '../../../lib/contact.js';
import { messagesLinkForProp } from '../../../lib/chatFormat.js';
import { queuePendingChat } from '../../../services/conversationService.js';
import { ContactBox } from './ContactBox.jsx';

/**
 * `ownerHidesNumber` arrives as a prop rather than being looked up here. It is part of the same
 * gate answer that produced `contactApproved`, so passing it down keeps the WhatsApp button and
 * the number reveal deciding from one value — a second lookup could disagree with the first and
 * offer a direct channel to an owner who asked to stay masked.
 */
export function OwnerCard({ p, isIn, toast, contactApproved, ownerHidesNumber = false, ownerMob, onContact, canChat }) {
  const { t } = useTranslation();
  /* Two independent trust signals, and they must not be collapsed into one sentence. `ownerVerified`
   * says the *person* passed Aadhaar/DigiLocker; `ownershipVerified` says the *paperwork* for this
   * flat checked out. A listing can carry either alone — the seed has both cases — and the card used
   * to print "Verified Owner · Ownership Verified" whenever either was true, which told buyers an
   * unverified owner had passed identity checks. That is the precise claim the badge exists to make
   * unfakeable, so asserting it on the strength of a different check is worse than showing nothing.
   * `listings/Card.jsx` already builds the label this way; this is the same rule, applied here. */
  const identityVerified = !!p.ownerVerified;
  const anyVerified = identityVerified || !!p.ownershipVerified;
  const verifiedLabel = [identityVerified ? t('listings.verifOwner') : '', p.ownershipVerified ? t('listings.verifOwnership') : '']
    .filter(Boolean)
    .join(' · ');
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
            {anyVerified && <Icon name="badge-check" className="w-4 h-4 text-brand-teal-2" />}
          </div>
          {anyVerified ? (
            <span className="text-xs text-emerald-300 flex items-center gap-1"><Icon name="badge-check" className="w-3 h-3" /> {verifiedLabel}</span>
          ) : (
            <span className="text-xs text-gray-400">{t('listings.owner')}</span>
          )}
        </div>
      </Link>
      <ContactBox p={p} isIn={isIn} toast={toast} />
      {/* A claim about how fast a *person* replies, so it hangs on the person's badge alone. */}
      {identityVerified && (
        <div className="mb-3 -mt-1 flex items-center gap-1.5 text-[11px] text-emerald-300/90">
          <Icon name="zap" className="w-3.5 h-3.5" /> {t('property.verifiedRespondsFaster')}
        </div>
      )}
      <div className="flex gap-2">
        {contactApproved && canChat ? (
          <div className="hidden lg:flex flex-1">
            <Link to={messagesLinkForProp(p)} onClick={() => queuePendingChat(p, { active: true })} className="w-full flex items-center justify-center gap-1.5 rounded-lg btn-teal text-xs font-semibold py-2 px-3 shadow-none"><Icon name="message-circle" className="w-3.5 h-3.5" /> {t('property.chatWithOwner')}</Link>
          </div>
        ) : (
          <div className="hidden lg:flex flex-1">
            <button onClick={onContact} className="w-full flex items-center justify-center gap-1.5 rounded-lg btn-teal text-xs font-semibold py-2 px-3 shadow-none"><Icon name="message-circle" className="w-3.5 h-3.5" /> {t('property.contactOwner')}</button>
          </div>
        )}
        <Link to={`/owner/${p.ownerId}`} className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] py-2 sm:min-h-0 rounded-lg border border-white/10 text-slate-300 text-[13px] sm:text-xs font-medium hover:bg-white/5 transition-smooth"><Icon name="user" className="w-3.5 h-3.5" /> {t('property.profile')}</Link>
      </div>
      {contactApproved && !ownerHidesNumber && (
        <a href={`https://wa.me/91${digits(ownerMob)}?text=${encodeURIComponent(`Hi, I'm interested in your property "${p.title}" listed on PuneNest. Is it still available?`)}`} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 min-h-[44px] py-2.5 sm:min-h-0 text-sm font-semibold text-white hover:bg-emerald-500 transition">
          <Icon name="message-circle" className="w-4 h-4" /> {t('property.chatOnWhatsapp')}
        </a>
      )}
      <Link to="/tenant-profile" className="mt-3 flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 text-[13px] sm:text-[11px] text-emerald-300 hover:text-emerald-200"><Icon name="user-check" className="w-3.5 h-3.5" /> {t('property.verifiedTenantBadge')}</Link>
    </div>
  );
}