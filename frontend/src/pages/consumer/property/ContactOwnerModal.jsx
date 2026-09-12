import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import AadhaarVerifyModal from '../../../components/auth/AadhaarVerifyModal.jsx';
import ContactsExhaustedModal from '../../../components/property/ContactsExhaustedModal.jsx';
import { maskPhone, fmtPhone, digits } from '../../../lib/contact.js';
import { requestContact } from '../../../services/contactService.js';
import { useContactGate } from './useContactGate.js';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { queuePendingChat } from '../../../services/conversationService.js';
import { useVerification } from '../../../context/VerificationContext.jsx';
import { track, captureLead } from '../../../lib/pmf.js';

export function ContactOwnerModal({ p, isIn, onClose, toast }) {
  const { t } = useTranslation();
  const [msg, setMsg] = useState('');
  const [verify, setVerify] = useState(false); // opt-in badge modal for verified-only owners
  const [quotaOpen, setQuotaOpen] = useState(false); // free contacts spent → refer or upgrade
  const [busy, setBusy] = useState(false);
  const { flagEnabled } = useAppFlags();
  const ownerMobile = String(p.ownerMobile || '');
  const propId = String(p.id || '');
  const { gate, loading } = useContactGate(propId);
  const status = gate.status;
  const ownerHides = status === 'approved' && gate.ownerHidesNumber;
  const revealed = status === 'owner' || (status === 'approved' && !ownerHides);
  // B1: seeker nudge at value moment — only when owner is verified and seeker is not yet.
  const { verified: seekerVerified } = useVerification();

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const request = async () => {
    if (!isIn) {
      toast(t('property.signInRequestNumber'), 'info');
      onClose();
      return;
    }
    // Free contact quota spent → offer the referral (free) or Seeker Plus route. The refusal is the
    // server's (422 `contact_quota_exhausted`), caught below — there is no local pre-check, because
    // a browser that could answer this question could also answer it generously.
    track('contact_click', { action: 'request_number', id: propId });
    captureLead({ context: 'request_number', property: propId, owner: String(p.owner || '') });

    setBusy(true);
    try {
      await requestContact(propId);
      toast(t('property.requestSentNumber'), 'success');
      onClose();
    } catch (err) {
      // Owner accepts verified contacts only → offer the opt-in badge flow instead of a request.
      if (err?.code === 'verification_required') {
        setVerify(true);
        return;
      }
      if (err?.code === 'contact_quota_exhausted') {
        setQuotaOpen(true);
        return;
      }
      if (err?.status === 401) {
        toast(t('property.signInRequestNumber'), 'info');
        onClose();
        return;
      }
      // Listing withdrawn / owner contact pulled — nothing was requested, so no quota is spent.
      toast(t('property.contactUnavailable'), 'error');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // Sending an enquiry/message is L1-only (badge-not-gate): any signed-in user may
  // reach the owner. Once sent, it starts a real in-app chat request the owner can
  // accept in Messages, giving the buyer a genuine channel to chat.
  const sendEnquiry = () => {
    if (!isIn) {
      toast(t('property.signInContactOwner'), 'info');
      onClose();
      return;
    }
    track('contact_click', { action: 'send_enquiry', id: propId });
    captureLead({ context: 'send_enquiry', property: propId, owner: String(p.owner || ''), message: msg.trim() });
    if (flagEnabled('inAppMessaging')) {
      queuePendingChat(p, { firstMessage: msg.trim() || undefined });
      toast(t('property.enquirySentChat'), 'success');
    } else {
      toast(t('property.enquirySent'), 'success');
    }
    onClose();
  };

  return (
    <div className="dz-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('property.contactTheOwner')} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dz-modal">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{t('property.contactTheOwner')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t('property.noBrokerageSub')}</p>
          </div>
          <button onClick={onClose} className="dz-modal-x" aria-label={t('property.close')}><Icon name="x" className="w-5 h-5" /></button>
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
                    <button type="button" onClick={request} disabled={busy || loading} className="btn-teal inline-flex items-center gap-1.5 py-2 px-3.5 text-xs rounded-[10px] disabled:opacity-60">
                      <Icon name="lock-keyhole" className="w-3.5 h-3.5" /> {t('property.requestNumber')}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <label className="block text-sm font-medium text-slate-300 mb-2">{t('property.sendQuickMessage')} <span className="text-slate-500 font-normal">({t('property.optional')})</span></label>
        {/* B1 — seeker nudge at value moment: fires only after the owner contact area is
            shown (value delivered), when the owner is verified and seeker is not yet.
            Non-blocking: the user can still send the enquiry without verifying. */}
        {p.ownerVerified && !seekerVerified && (
          <div className="mb-3 rounded-xl bg-teal-500/10 border border-teal-500/20 px-4 py-3 flex items-start gap-2.5">
            <Icon name="shield-check" className="w-4 h-4 text-teal-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-teal-300">{t('verify.buyerNudgeTitle')}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{t('verify.buyerNudgeBody')}</p>
              <button type="button" onClick={() => setVerify(true)} className="mt-2 text-[11px] text-teal-400 font-semibold hover:text-teal-300 inline-flex items-center gap-1">
                {t('verify.buyerNudgeCta')} <Icon name="arrow-right" className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} enterKeyHint="send" className="w-full px-4 py-3 rounded-xl text-white text-sm resize-none border border-white/10 bg-white/[0.03] focus:border-brand-teal-2 outline-none mb-3" placeholder={t('property.messagePlaceholder')} />
        <button onClick={sendEnquiry} className="btn-teal w-full flex items-center justify-center gap-2 py-2.5 px-4"><Icon name="send" className="w-4 h-4" /> {t('property.sendEnquiry')}</button>
        <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-1.5"><Icon name="shield-check" className="w-3.5 h-3.5" /> {t('property.numberStaysPrivate')}</p>
      </div>
      {verify && (
        <AadhaarVerifyModal
          source="contact_owner_modal"
          subtitle={t('verify.subtitleVerifiedOnly')}
          onClose={() => setVerify(false)}
          onVerified={() => {
            setVerify(false);
            toast(t('property.identityVerifiedToast'), 'success');
            request();
          }}
        />
      )}
      {quotaOpen && <ContactsExhaustedModal onClose={() => setQuotaOpen(false)} />}
    </div>
  );
}
