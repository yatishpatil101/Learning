import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Button from '../../../components/ui/Button.jsx';
import AadhaarVerifyModal from '../../../components/auth/AadhaarVerifyModal.jsx';
import ContactsExhaustedModal from '../../../components/property/ContactsExhaustedModal.jsx';
import { contactStatus, requestContact, maskPhone, fmtPhone, digits, ownerHidesNumber } from '../../../lib/contact.js';
import { canRevealContact, consumeContact, contactsRemaining } from '../../../lib/store.js';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { track, captureLead } from '../../../lib/pmf.js';

export function ContactBox({ p, isIn, toast }) {
  const { t } = useTranslation();
  const { flagEnabled } = useAppFlags();
  const ownerMobile = String(p.ownerMobile || '');
  const propId = p.id || '';
  const [status, setStatus] = useState(() => contactStatus(ownerMobile, propId));
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [left, setLeft] = useState(() => contactsRemaining());
  // An owner can approve a request yet still keep their number masked (Settings ▸
  // Owner phone privacy) — approved buyers are routed to in-app chat instead.
  const ownerHides = status === 'approved' && ownerHidesNumber(ownerMobile);
  const revealed = status === 'owner' || (status === 'approved' && !ownerHides);

  const request = () => {
    if (!isIn) {
      toast(t('property.signInRequestNumber'), 'info');
      return;
    }
    // Free contact quota spent → offer the referral (free) or Seeker Plus route.
    if (status === 'none' && !canRevealContact()) {
      setQuotaOpen(true);
      return;
    }
    track('contact_click', { action: 'request_number', id: propId });
    captureLead({ context: 'request_number', property: String(propId) });
    const res = requestContact(ownerMobile, propId);
    // Owner accepts verified contacts only → offer the opt-in badge flow instead of a request.
    if (res === 'verification_required') {
      setVerifyOpen(true);
      return;
    }
    setStatus(contactStatus(ownerMobile, propId));
    // Only a genuinely NEW request burns quota — repeats return the existing status.
    if (res === 'pending') { consumeContact(); setLeft(contactsRemaining()); }
    if (res === 'pending') toast(t('property.requestSentNumber'), 'success');
    else if (res === 'approved') toast(t('property.ownerSharedNumber'), 'success');
    else if (res === 'declined') toast(t('property.ownerDeclinedRequest'), 'info');
  };

  return (
    <div className="mb-3 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
      {revealed ? (
        <>
          <a href={`tel:+91${digits(ownerMobile)}`} className="flex items-center gap-2 text-sm text-brand-teal-3 hover:underline transition-smooth">
            <Icon name="phone" className="w-4 h-4" /> {fmtPhone(ownerMobile)}
          </a>
          <p className="text-[11px] text-emerald-300 mt-1 flex items-center gap-1">
            {status === 'owner'
              ? <>{t('property.yourListingNumber')}</>
              : <><Icon name="badge-check" className="w-3 h-3" /> {t('property.numberShared')}</>}
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Icon name="phone-off" className="w-4 h-4 text-slate-500" />
            <span className="tracking-wider">{maskPhone(ownerMobile)}</span>
          </div>
          {ownerHides ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-emerald-300 font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Icon name="message-circle" className="w-3.5 h-3.5" /> {t('property.approvedPrefersChat')}
            </p>
          ) : status === 'pending' ? (
            <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-300 font-medium px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Icon name="clock" className="w-3.5 h-3.5" /> {t('property.requestSentAwaiting')}
            </span>
          ) : status === 'declined' ? (
            <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400 font-medium px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <Icon name="x-circle" className="w-3.5 h-3.5" /> {t('property.ownerDeclined')}
            </span>
          ) : (
            <>
              <p className="text-[11px] text-slate-500 mt-0.5">{t('property.hiddenPrivacy')}</p>
              <Button onClick={request} variant="primary" size="sm" fullWidth icon="lock-keyhole" className="mt-2">{t('property.requestNumber')}</Button>
              {isIn && Number.isFinite(left) && (
                <p className="text-[11px] mt-1.5 text-center" data-testid="contacts-left">
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
      {verifyOpen && (
        <AadhaarVerifyModal
          source="contact_box"
          subtitle={t('verify.subtitleVerifiedOnly')}
          onClose={() => setVerifyOpen(false)}
          onVerified={() => { toast(t('property.identityVerifiedToast'), 'success'); request(); }}
        />
      )}
      {quotaOpen && <ContactsExhaustedModal onClose={() => setQuotaOpen(false)} />}
    </div>
  );
}
