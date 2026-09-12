import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Button from '../../../components/ui/Button.jsx';
import AadhaarVerifyModal from '../../../components/auth/AadhaarVerifyModal.jsx';
import ContactsExhaustedModal from '../../../components/property/ContactsExhaustedModal.jsx';
import { maskPhone, fmtPhone, digits } from '../../../lib/contact.js';
import { requestContact } from '../../../services/contactService.js';
import { useContactGate } from './useContactGate.js';
import { useEntitlements, contactsLeft } from './useEntitlements.js';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { track, captureLead } from '../../../lib/pmf.js';

export function ContactBox({ p, isIn, toast }) {
  const { t } = useTranslation();
  const { flagEnabled } = useAppFlags();
  const ownerMobile = String(p.ownerMobile || '');
  const propId = p.id || '';
  const { gate, loading, setGate } = useContactGate(propId);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { entitlements, refresh: refreshEntitlements } = useEntitlements(isIn);
  const left = contactsLeft(entitlements);
  const status = gate.status;
  // An owner can approve a request yet still keep their number masked (Settings ▸
  // Owner phone privacy) — approved buyers are routed to in-app chat instead.
  const ownerHides = status === 'approved' && gate.ownerHidesNumber;
  const revealed = status === 'owner' || (status === 'approved' && !ownerHides);

  const request = async () => {
    if (!isIn) {
      toast(t('property.signInRequestNumber'), 'info');
      return;
    }
    track('contact_click', { action: 'request_number', id: propId });
    captureLead({ context: 'request_number', property: String(propId) });

    setBusy(true);
    try {
      const next = await requestContact(propId);
      setGate(next);
      // The quota is the server's now, so the only honest way to know what is left is to ask again
      // after it has moved. The old code decremented a local counter here, which was wrong twice:
      // it assumed the press had cost something, and it could not see contacts spent in another tab.
      if (next.status === 'pending' && status !== 'pending') refreshEntitlements();
      if (next.status === 'pending') toast(t('property.requestSentNumber'), 'success');
      else if (next.status === 'approved') toast(t('property.ownerSharedNumber'), 'success');
      else if (next.status === 'declined') toast(t('property.ownerDeclinedRequest'), 'info');
    } catch (err) {
      // Owner accepts verified contacts only → offer the opt-in badge flow instead of a request.
      if (err?.code === 'verification_required') setVerifyOpen(true);
      // Free contacts spent. This arrives as a refusal from the server rather than being decided
      // here, so the modal opens on the same press that was refused — one round trip, not zero.
      else if (err?.code === 'contact_quota_exhausted') setQuotaOpen(true);
      else if (err?.status === 401) toast(t('property.signInRequestNumber'), 'info');
      else toast(t('property.contactUnavailable'), 'error');
    } finally {
      setBusy(false);
    }
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
          {loading ? (
            /* The gate is a network read now. `NO_CONTACT_GATE` renders as "no request made",
               which is also the state that shows the request button — so rendering the action row
               before the answer lands flashes "Request number" at a buyer who was already
               approved, then corrects itself. Hold the row instead; the masked number above is
               true in every state, so there is nothing misleading on screen meanwhile. */
            <div className="mt-2 h-9 rounded-lg bg-white/5 animate-pulse" aria-hidden="true" />
          ) : ownerHides ? (
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
              <Button onClick={request} disabled={busy} variant="primary" size="sm" fullWidth icon="lock-keyhole" className="mt-2">{t('property.requestNumber')}</Button>
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
