import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import VerifyIdentityRedirect from '../../../components/auth/VerifyIdentityRedirect.jsx';
import ContactsExhaustedModal from '../../../components/property/ContactsExhaustedModal.jsx';
import { maskPhone, fmtPhone } from '../../../lib/contact.js';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import { requestContact } from '../../../services/contactService.js';
import { useContactGate } from './useContactGate.js';
import { useEntitlements, contactsLeft } from './useEntitlements.js';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { messagesLinkForProp } from '../../../lib/chatFormat.js';
import { queuePendingChat } from '../../../services/conversationService.js';
import { useVerification } from '../../../context/VerificationContext.jsx';
import { track, captureLead } from '../../../lib/pmf.js';
import useScrollLock from '../../../hooks/useScrollLock.js';
import useModalDialog from '../../../hooks/useModalDialog.js';
import { dialableMobile, telHref, whatsappHref } from './contactPhone.js';
import { ownerVerificationMeta, OwnerRoleLine, OwnerVerifiedMark } from './ownerVerification.jsx';

export function ContactOwnerModal({ p, isIn, onClose, toast }) {
  const { t } = useTranslation();
  const sendToSignIn = useSignInGate();
  const navigate = useNavigate();
  const [msg, setMsg] = useState('');
  const [verify, setVerify] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  // opt-in badge modal for verified-only owners
  // free contacts spent → refer or upgrade
  const [busy, setBusy] = useState(false);
  const { flagEnabled } = useAppFlags();
  const ownerMobile = String(p.ownerMobile || '');
  const propId = String(p.id || '');
  const { id: routeId } = useParams();
  const { gate, loading } = useContactGate(routeId || propId);
  // `isIn` gates the fetch: signed out there is no quota to report, and no token to ask with.
  const { entitlements } = useEntitlements(isIn);
  const left = contactsLeft(entitlements);
  const status = gate.status;
  const ownerHides = status === 'approved' && gate.ownerHidesNumber;
  const revealed = status === 'owner' || (status === 'approved' && !ownerHides);
  const { identityVerified, anyVerified, roleAndVerification } = ownerVerificationMeta(p, t);
  const { verified: seekerVerified } = useVerification();
  const panelRef = useModalDialog(true, onClose);
  const ownerDialable = dialableMobile(ownerMobile);

  useScrollLock();

  const request = async () => {
    if (!isIn) {
      /* Close only if the gate actually navigated. */
      if (sendToSignIn('contact')) onClose();
      return;
    }
    // Free contact quota spent, so offer the referral or Seeker Plus route. The refusal is the
    // server's, caught below: a browser that could pre-check this could also answer it generously.
    track('contact_click', { action: 'request_number', id: propId });
    captureLead({ context: 'request_number', property: propId });

    const back = window.location.pathname + window.location.search;
    setBusy(true);
    try {
      await requestContact(propId);
      toast(t('property.requestSentNumber'), 'success');
      onClose();
    } catch (err) {
      // Owner accepts verified contacts only, so offer the opt-in badge flow rather than a request.
      if (err?.code === 'verification_required') {
        setVerify(true);
        return;
      }
      if (err?.code === 'contact_quota_exhausted') {
        setQuotaOpen(true);
        return;
      }
      if (err?.status === 401) {
        /* `back` is the listing as it was when the request left: `signInPath` otherwise reads `window.location` at
           call time and would return them to wherever they navigated meanwhile. */
        if (sendToSignIn('contact', back)) onClose();
        return;
      }
      // Listing withdrawn / owner contact pulled — nothing was requested, so no quota is spent.
      toast(t('property.contactUnavailable'), 'error');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const ensureRequest = async (message) => {
    if (status === 'owner' || status === 'approved') return;
    await requestContact(propId, message);
  };

  const handleContactError = (err, back) => {
    if (err?.code === 'verification_required') {
      setVerify(true);
      return true;
    }
    if (err?.code === 'contact_quota_exhausted') {
      setQuotaOpen(true);
      return true;
    }
    if (err?.status === 401) {
      if (sendToSignIn('contact', back)) onClose();
      return true;
    }
    return false;
  };

  const startChat = async () => {
    if (!isIn) {
      if (sendToSignIn('contact')) onClose();
      return;
    }
    track('contact_click', { action: 'start_chat', id: propId });
    captureLead({ context: 'start_chat', property: propId });
    const back = window.location.pathname + window.location.search;
    setBusy(true);
    try {
      await ensureRequest();
      await queuePendingChat(p, { active: status === 'owner' || status === 'approved' });
      onClose();
      navigate(messagesLinkForProp(p));
    } catch (err) {
      if (!handleContactError(err, back)) toast(t('property.contactUnavailable'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendEnquiry = async () => {
    if (!isIn) {
      if (sendToSignIn('contact')) onClose();
      return;
    }
    track('contact_click', { action: 'send_enquiry', id: propId });
    captureLead({ context: 'send_enquiry', property: propId });
    const text = msg.trim();
    const back = window.location.pathname + window.location.search;
    setBusy(true);
    try {
      await ensureRequest(text || undefined);
      if (flagEnabled('inAppMessaging')) {
        await queuePendingChat(p, { firstMessage: text || undefined, active: status === 'owner' || status === 'approved' });
        toast(t('property.enquirySentChat'), 'success');
      } else {
        toast(t('property.requestSentOwner'), 'success');
      }
    } catch (err) {
      if (!handleContactError(err, back)) toast(t('property.contactUnavailable'), 'error');
      return;
    } finally {
      setBusy(false);
    }
    onClose();
  };

  return (
    <div
      className="dz-modal-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={panelRef} tabIndex={-1} className="dz-modal outline-none" role="dialog" aria-modal="true" aria-label={t('property.contactTheOwner')}>
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
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-white">{p.owner}</span>
              <OwnerVerifiedMark anyVerified={anyVerified} />
            </div>
            <OwnerRoleLine anyVerified={anyVerified} roleAndVerification={roleAndVerification} ownerLabel={t('listings.owner')} />
          </div>
        </div>

        {/* A claim about how fast a *person* replies, so it hangs on the person's badge alone. */}
        {identityVerified && (
          <div className="-mt-2 mb-4 flex items-center gap-1.5 text-[11px] text-emerald-300/90">
            <Icon name="zap" className="w-3.5 h-3.5" /> {t('property.verifiedRespondsFaster')}
          </div>
        )}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          {revealed ? (
            <>
              <p className="text-xs text-slate-400 mb-1">{t('property.ownersNumber')}</p>
              {ownerDialable ? (
                <>
                  <a href={telHref(ownerMobile)} className="flex items-center gap-2 text-base font-semibold text-brand-teal-3 hover:underline"><Icon name="phone" className="w-4 h-4" /> {fmtPhone(ownerMobile)}</a>
                  <a href={whatsappHref(ownerMobile)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2 text-emerald-400 text-xs font-medium hover:underline"><Icon name="message-circle" className="w-3.5 h-3.5" /> {t('property.messageOnWhatsapp')}</a>
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-slate-300 mb-2"><Icon name="phone-off" className="w-4 h-4 text-slate-500" /> <span className="tracking-wider">{maskPhone(ownerMobile)}</span></div>
              )}
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
                    <>
                      <button type="button" onClick={request} disabled={busy || loading} className="btn-teal inline-flex items-center gap-1.5 py-2 px-3.5 text-xs rounded-[10px] disabled:opacity-60">
                        <Icon name="lock-keyhole" className="w-3.5 h-3.5" /> {t('property.requestNumber')}
                      </button>

                      {/* Below `lg` this sheet is the only contact surface, so the free-contact countdown has to be
                         here or a phone buyer meets the wall as a bare 422. */}
                      {isIn && Number.isFinite(left) && (
                        <p className="text-[11px] mt-1.5" data-testid="contacts-left">
                          {left > 0 ? (
                            <span className="text-slate-500">{t('property.contactsLeft', { count: left })}</span>
                          ) : (
                            <span className="text-amber-300">{t(flagEnabled('referralRewards') ? 'property.contactsLeftNoneReferHint' : 'property.contactsLeftNone')}</span>
                          )}
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2 mb-4">
          {flagEnabled('inAppMessaging') && (
            <button type="button" onClick={startChat} disabled={loading || busy} className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] rounded-lg btn-teal text-[13px] font-semibold px-3 shadow-none disabled:opacity-60"><Icon name="message-circle" className="w-3.5 h-3.5" /> {t('property.chatWithOwner')}</button>
          )}
          {p.ownerId && (
            <Link to={`/owner/${p.ownerId}`} className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] rounded-lg border border-white/10 text-slate-300 text-[13px] font-medium hover:bg-white/5 transition-smooth"><Icon name="user" className="w-3.5 h-3.5" /> {t('property.profile')}</Link>
          )}
        </div>
        <label className="block text-sm font-medium text-slate-300 mb-2">{t('property.sendQuickMessage')} <span className="text-slate-500 font-normal">({t('property.optional')})</span></label>
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
        <button onClick={sendEnquiry} disabled={busy} className="btn-teal w-full flex items-center justify-center gap-2 py-2.5 px-4 disabled:opacity-60"><Icon name="send" className="w-4 h-4" /> {t('property.sendEnquiry')}</button>
        <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-1.5"><Icon name="shield-check" className="w-3.5 h-3.5" /> {t('property.numberStaysPrivate')}</p>
        <Link to="/tenant-profile" className="mt-3 flex items-center justify-center gap-1.5 min-h-[44px] text-[13px] text-emerald-300 hover:text-emerald-200"><Icon name="user-check" className="w-3.5 h-3.5" /> {t('property.verifiedTenantBadge')}</Link>
      </div>
      {verify && (
        <VerifyIdentityRedirect
          source="contact_owner_modal"
          onClose={() => setVerify(false)}
        />
      )}
      {quotaOpen && <ContactsExhaustedModal onClose={() => setQuotaOpen(false)} />}
    </div>
  );
}
