import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation, Trans } from 'react-i18next';
import Icon from '../Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { setAadhaarVerified } from '../../lib/store.js';
import { applyVerifiedBadgeToListings } from '../../lib/mockApi.js';
import { trackKyc } from '../../lib/kycTrack.js';

/* Opt-in "Verified" badge earn via native DigiLocker (badge-not-gate — ADR-019, ADR-009a).
   Verification is NEVER a wall: any signed-in user can browse, post and contact owners.
   This popup lets a user *opt in* to earn a Verified badge that builds trust and boosts
   ranking. It also backs the two narrow opt-in cases where a badge is asked for: an owner
   who accepts "verified contacts only", and light community actions.

   Identity is proven the government-native way — DigiLocker (via Cashfree Secure ID):
     1. We securely redirect the user to DigiLocker.
     2. The user signs in and enters their Aadhaar + OTP ON DIGILOCKER — never on PuneNest.
     3. The user approves a one-time consent to share their basic KYC.
     4. DigiLocker returns name, DOB, gender, address, photo and the last 4 digits of the
        Aadhaar (masked). We never see or store the full Aadhaar number or the OTP.

   Because the app is in the localStorage-mock phase, "Continue with DigiLocker" simulates
   the redirect → consent → success round-trip (in production POST /me/verification/aadhaar
   returns a DigiLocker consent URL and a webhook confirms the result). On success we record
   the badge (`setAadhaarVerified`) and run `onVerified()` to resume any pending action. */
export default function AadhaarVerifyModal({
  onClose,
  onVerified,
  source = 'unknown',
  subtitle,
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const signedMobile = String(user?.mobile || '').replace(/\D/g, '').slice(0, 10);
  const [step, setStep] = useState('intro'); // 'intro' | 'redirecting'
  const subtitleText = subtitle || t('verify.defaultSubtitle');
  const bold = { b: <strong className="text-slate-200" /> };

  useEffect(() => {
    trackKyc('badge_cta_impression', source);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && step === 'intro' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, step, source]);

  const startDigilocker = () => {
    trackKyc('badge_cta_click', source);
    trackKyc('digilocker_start', source);
    setStep('redirecting');
    // MOCK: production redirects the browser to DigiLocker's consent page and a
    // DIGILOCKER_VERIFICATION_SUCCESS webhook confirms the result; here we simulate
    // the successful round-trip. Aadhaar + OTP + consent all happen on DigiLocker.
    setTimeout(() => {
      setAadhaarVerified({
        aadhaarMobile: signedMobile,
        maskedAadhaar: 'XXXX XXXX 1234',
        mobileMatch: true, // soft signal only at MVP (ADR-009a)
        source: 'digilocker',
      });
      // Make the reward real: light up ownerVerified on this user's listings and
      // grant the one-time free Featured slot (ADR-019 growth lever).
      const perk = applyVerifiedBadgeToListings(signedMobile);
      trackKyc('digilocker_success', source);
      trackKyc('badge_earned', source, { featured: perk?.featuredTitle || null });
      onVerified?.(perk);
      onClose();
    }, 1700);
  };

  // Portal to <body> so the popup escapes any transformed / backdrop-filtered
  // ancestor (e.g. the glass owner card or the contact modal), which would
  // otherwise trap its position:fixed in a local stacking context.
  return createPortal((
    <div
      className="pn-modal-backdrop"
      style={{ zIndex: 300 }}
      role="dialog"
      aria-modal="true"
      aria-label={t('verify.title')}
      onClick={(e) => { if (e.target === e.currentTarget && step === 'intro') onClose(); }}
    >
      <div className="pn-modal" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
        <div className="flex items-start justify-between gap-3 p-5 pb-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center flex-shrink-0"><Icon name="shield-check" className="w-5 h-5 text-teal-400" /></div>
            <div>
              <h3 className="text-lg font-bold text-white">{t('verify.title')}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{subtitleText}</p>
            </div>
          </div>
          {step === 'intro' && (
            <button onClick={onClose} className="pn-modal-x" aria-label={t('verify.close')}><Icon name="x" className="w-5 h-5" /></button>
          )}
        </div>

        {step === 'redirecting' ? (
          <div className="px-5 pb-8 pt-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-teal-500/15 flex items-center justify-center mx-auto mb-4">
              <Icon name="loader-2" className="w-7 h-7 text-teal-400 animate-spin" />
            </div>
            <h4 className="text-base font-semibold text-white mb-1.5">{t('verify.opening')}</h4>
            <p className="text-sm text-slate-400 max-w-sm mx-auto leading-relaxed">
              <Trans i18nKey="verify.openingBody" components={bold} />
            </p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto min-h-0 px-5 space-y-3">
              {/* WHY */}
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs font-semibold text-slate-300 mb-2.5">{t('verify.whyTitle')}</p>
                <ul className="space-y-2 text-[13px] text-slate-300">
                  <li className="flex items-start gap-2.5"><Icon name="user-check" className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" /> <span>{t('verify.why1')}</span></li>
                  <li className="flex items-start gap-2.5"><Icon name="trending-up" className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" /> <span>{t('verify.why2')}</span></li>
                  <li className="flex items-start gap-2.5"><Icon name="clock" className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" /> <span>{t('verify.why3')}</span></li>
                </ul>
              </div>

              {/* HOW */}
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs font-semibold text-slate-300 mb-2.5">{t('verify.howTitle')}</p>
                <ol className="space-y-2.5 text-[13px] text-slate-300">
                  <li className="flex items-start gap-2.5"><span className="w-5 h-5 rounded-full bg-teal-500/15 text-teal-300 text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span><span className="leading-relaxed"><Trans i18nKey="verify.how1" components={bold} /></span></li>
                  <li className="flex items-start gap-2.5"><span className="w-5 h-5 rounded-full bg-teal-500/15 text-teal-300 text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span><span className="leading-relaxed"><Trans i18nKey="verify.how2" components={bold} /></span></li>
                  <li className="flex items-start gap-2.5"><span className="w-5 h-5 rounded-full bg-teal-500/15 text-teal-300 text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span><span className="leading-relaxed"><Trans i18nKey="verify.how3" components={bold} /></span></li>
                </ol>
              </div>

              {/* PRIVACY */}
              <div className="rounded-xl border border-teal-400/20 bg-teal-400/[0.05] p-3.5">
                <div className="flex items-start gap-2 mb-2">
                  <Icon name="lock" className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[13px] font-semibold text-teal-200">{t('verify.privacyTitle')}</p>
                </div>
                <p className="text-[12px] text-slate-300 leading-relaxed mb-1.5">
                  <Trans i18nKey="verify.privacyBody1" components={bold} />
                </p>
                <p className="text-[12px] text-slate-400 leading-relaxed">
                  <Trans i18nKey="verify.privacyBody2" components={bold} />
                </p>
              </div>
            </div>

            <div className="flex-shrink-0 px-5 pt-4 pb-[calc(1.25rem+var(--pn-safe-b))] border-t border-white/10 bg-[#14121f]">
              <div className="flex flex-col sm:flex-row gap-3">
                <button type="button" onClick={startDigilocker} className="btn-teal w-full sm:flex-1 px-6 py-3 rounded-xl text-white font-semibold text-sm inline-flex items-center justify-center gap-2">
                  <Icon name="external-link" className="w-4 h-4" /> {t('verify.continue')}
                </button>
                <button type="button" onClick={onClose} className="btn-outline w-full sm:w-auto px-6 py-3 rounded-xl text-slate-300 font-semibold text-sm">{t('verify.later')}</button>
              </div>
              <p className="text-[11px] text-slate-500 text-center mt-3.5 flex items-center justify-center gap-1.5">
                <Icon name="shield-check" className="w-3.5 h-3.5 flex-shrink-0" /> {t('verify.footer')}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}
