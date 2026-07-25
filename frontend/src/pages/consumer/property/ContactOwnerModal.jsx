import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import AadhaarVerifyModal from '../../../components/auth/AadhaarVerifyModal.jsx';
import { contactStatus, requestContact, maskPhone, fmtPhone, digits, ownerHidesNumber } from '../../../lib/contact.js';
import { isAadhaarVerified } from '../../../lib/store.js';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { queueOwnerChat } from '../../../lib/chat.js';

export function ContactOwnerModal({ p, isIn, onClose, toast }) {
  const { t } = useTranslation();
  const [msg, setMsg] = useState('');
  const [verify, setVerify] = useState(null); // null | 'request' | 'enquiry'
  const { flagEnabled } = useAppFlags();
  const ownerMobile = String(p.ownerMobile || '');
  const propId = String(p.id || '');
  const status = contactStatus(ownerMobile, propId);
  const ownerHides = status === 'approved' && ownerHidesNumber(ownerMobile);
  const revealed = status === 'owner' || (status === 'approved' && !ownerHides);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const request = () => {
    if (!isIn) {
      toast(t('property.signInRequestNumber'), 'info');
      onClose();
      return;
    }
    const res = requestContact(ownerMobile, propId);
    // Blanket Aadhaar gate — unverified users get the verification popup, not a request.
    if (res === 'aadhaar_required') {
      setVerify('request');
      return;
    }
    toast(t('property.requestSentNumber'), 'success');
    onClose();
  };

  // Sending an enquiry/message is also "contacting the owner" — same Aadhaar gate.
  // Once verified, it starts a real in-app chat request the owner can accept in Messages
  // (instead of a dead-end toast), giving the buyer a genuine channel to chat.
  const sendEnquiry = () => {
    if (!isIn) {
      toast(t('property.signInContactOwner'), 'info');
      onClose();
      return;
    }
    if (!isAadhaarVerified()) {
      setVerify('enquiry');
      return;
    }
    if (flagEnabled('inAppMessaging')) {
      queueOwnerChat(p, { firstMessage: msg.trim() || undefined });
      toast(t('property.enquirySentChat'), 'success');
    } else {
      toast(t('property.enquirySent'), 'success');
    }
    onClose();
  };

  return (
    <div className="pn-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('property.contactTheOwner')} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pn-modal">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{t('property.contactTheOwner')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t('property.noBrokerageSub')}</p>
          </div>
          <button onClick={onClose} className="pn-modal-x" aria-label={t('property.close')}><Icon name="x" className="w-5 h-5" /></button>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-brand-teal-1 to-brand-indigo-4 flex items-center justify-center text-white font-bold">{(p.owner || 'A')[0]}</div>
          <div>
            <div className="flex items-center gap-1.5"><span className="font-semibold text-white">{p.owner}</span><Icon name="badge-check" className="w-4 h-4 text-brand-teal-2" /></div>
            <span className="text-xs text-emerald-300 flex items-center gap-1"><Icon name="badge-check" className="w-3 h-3" /> {t('property.verifiedOwner')}</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          {revealed ? (
            <>
              <p className="text-xs text-slate-400 mb-1">{t('property.ownersNumber')}</p>
              <a href={`tel:+91${digits(ownerMobile)}`} className="flex items-center gap-2 text-base font-semibold text-brand-teal-3 hover:underline"><Icon name="phone" className="w-4 h-4" /> {fmtPhone(ownerMobile)}</a>
              <a href={`https://wa.me/91${digits(ownerMobile)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2 text-emerald-400 text-xs font-medium hover:underline"><Icon name="message-circle" className="w-3.5 h-3.5" /> {t('property.messageOnWhatsapp')}</a>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-400 mb-1">{t('property.ownersNumber')}</p>
              <div className="flex items-center gap-2 text-sm text-slate-300 mb-2"><Icon name="phone-off" className="w-4 h-4 text-slate-500" /> <span className="tracking-wider">{maskPhone(ownerMobile)}</span></div>
              {ownerHides ? (
                <>
                  <p className="text-[11px] text-slate-500 mb-2.5">{t('property.approvedPrefersChatBody')}</p>
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <Icon name="message-circle" className="w-3.5 h-3.5" /> {t('property.chatBelow')}
                  </span>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-slate-500 mb-2.5">{t('property.hiddenPrivacy')}</p>
                  {status === 'pending' && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-amber-300 font-medium px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <Icon name="clock" className="w-3.5 h-3.5" /> {t('property.requestSentAwaiting')}
                    </span>
                  )}
                  {status === 'declined' && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 font-medium px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
                      <Icon name="x-circle" className="w-3.5 h-3.5" /> {t('property.ownerDeclined')}
                    </span>
                  )}
                  {status !== 'pending' && status !== 'declined' && (
                    <button type="button" onClick={request} className="btn-teal inline-flex items-center gap-1.5 py-2 px-3.5 text-xs rounded-[10px]">
                      <Icon name="lock-keyhole" className="w-3.5 h-3.5" /> {t('property.requestNumber')}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <label className="block text-sm font-medium text-slate-300 mb-2">{t('property.sendQuickMessage')} <span className="text-slate-500 font-normal">({t('property.optional')})</span></label>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} className="w-full px-4 py-3 rounded-xl text-white text-sm resize-none border border-white/10 bg-white/[0.03] focus:border-brand-teal-2 outline-none mb-3" placeholder={t('property.messagePlaceholder')} />
        <button onClick={sendEnquiry} className="btn-teal w-full flex items-center justify-center gap-2 py-2.5 px-4"><Icon name="send" className="w-4 h-4" /> {t('property.sendEnquiry')}</button>
        <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-1.5"><Icon name="shield-check" className="w-3.5 h-3.5" /> {t('property.numberStaysPrivate')}</p>
      </div>
      {verify && (
        <AadhaarVerifyModal
          onClose={() => setVerify(null)}
          onVerified={() => {
            const action = verify;
            setVerify(null);
            toast(t('property.identityVerifiedToast'), 'success');
            if (action === 'request') request(); else sendEnquiry();
          }}
        />
      )}
    </div>
  );
}
