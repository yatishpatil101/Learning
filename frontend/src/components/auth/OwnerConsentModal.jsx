import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import OtpBoxes from './OtpBoxes.jsx';
import { useOtpFlow } from './useOtpFlow.js';
import { requestOwnerConsent } from '../../services/flatmateService.js';
import useScrollLock from '../../hooks/useScrollLock.js';
/* Owner-consent OTP ping. */

export default function OwnerConsentModal({ ownerMobile, title, locality, onClose, onVerified }) {
  /* The surrounding copy is English, but `otp.sendError` is an i18n key by contract. */
  const { t } = useTranslation();
  const owner = String(ownerMobile || '').replace(/\D/g, '').slice(0, 10);
  const [verifying, setVerifying] = useState(false);
  /* The address rides on the SEND too, not just the record. */
  const [failed, setFailed] = useState(null);
  const otp = useOtpFlow((mobile) => requestOwnerConsent({ ownerMobile: mobile, title, locality }));

  useScrollLock();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setFailed(null);
    if (!otp.otpSent) { otp.send(owner); return; }
    if (otp.otp.length !== 6) { otp.setOtpError(true); return; }
    setVerifying(true);
    try {
      // A wrong code answers 401 and a spent attempt cap 429, so the only way to reach
      // `onVerified` is for the owner to have actually acted.
      const { consentRecorded } = await requestOwnerConsent({
        ownerMobile: owner, otp: otp.otp, title, locality,
      });
      if (!consentRecorded) throw new Error('consent not recorded');
      onVerified?.();
      onClose();
    } catch (err) {
      setFailed(err?.body?.message || 'That code did not match. Ask the owner to read it out again.');
      otp.setOtpError(true);
    } finally {
      setVerifying(false);
    }
  };

  return createPortal((
    <div
      className="dz-modal-backdrop"
      style={{ zIndex: 300 }}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm the flat owner's consent"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="dz-modal">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center"><Icon name="badge-check" className="w-5 h-5 text-teal-400" /></div>
            <div>
              <h3 className="text-lg font-bold text-white">Confirm the owner's consent</h3>
              <p className="text-xs text-slate-400 mt-0.5">We'll text the owner a code.</p>
            </div>
          </div>
          <button onClick={onClose} className="dz-modal-x" aria-label="Close"><Icon name="x" className="w-5 h-5" /></button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Flat owner's mobile</label>
            <div className="flex items-center gap-3 h-[52px] px-4 rounded-xl border border-white/10 bg-white/[0.04]">
              <span className="inline-flex items-center gap-1.5 text-sm text-slate-400 select-none"><span className="text-base leading-none">🇮🇳</span> +91</span>
              <span className="text-sm text-white font-medium tracking-wide flex-1">{owner}</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-teal-300"><Icon name="badge-check" className="w-3.5 h-3.5" /> Owner</span>
            </div>
            {otp.sendError && (
              <p className="text-red-400 text-xs mt-2">{t(otp.sendError)}</p>
            )}
          </div>

          {otp.otpSent && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-4 text-center">Enter the code the owner received</label>
              <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); }} error={otp.otpError} />
              {otp.otpError && !failed && <p className="text-red-400 text-xs text-center mt-2">Please enter the complete 6-digit OTP</p>}
              {failed && <p className="text-red-400 text-xs text-center mt-2">{failed}</p>}
              <div className="flex items-center justify-center gap-2 text-sm mt-4">
                {/* The number, explicitly: `resend` forwards its argument to the dispatch, so a bare handler
                   reference would post React's click event as `ownerMobile`. */}
                <span className="text-slate-500">Owner didn't get it?</span>
                <button type="button" onClick={() => otp.resend(owner)} disabled={!otp.canResend} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {otp.canResend ? 'Resend OTP' : `Resend in ${otp.seconds}s`}
                </button>
              </div>
            </div>
          )}

          <button type="submit" disabled={verifying || otp.sending} className="btn-teal w-full text-sm font-semibold text-white px-6 py-3 rounded-xl inline-flex items-center justify-center gap-2">
            {verifying && <><Icon name="loader-2" className="w-4 h-4 animate-spin" /> Confirming…</>}
            {!verifying && otp.sending && <><Icon name="loader-2" className="w-4 h-4 animate-spin" /> Sending…</>}
            {!verifying && !otp.sending && otp.otpSent && <><Icon name="check" className="w-4 h-4" /> Confirm consent</>}
            {!verifying && !otp.sending && !otp.otpSent && <><Icon name="send" className="w-4 h-4" /> Send OTP to owner</>}
          </button>
        </form>
      </div>
    </div>
  ), document.body);
}
