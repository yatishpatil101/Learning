import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon.jsx';
import OtpBoxes from './OtpBoxes.jsx';
import { useOtpFlow } from './useOtpFlow.js';
import { setOwnerConsent } from '../../lib/data/flatmates.js';
import { fmtPhone } from '../../lib/contact.js';

/* Owner-consent OTP ping. A sitting tenant listing a replacement flatmate can't
   produce ownership docs, so instead the flat's OWNER confirms — via an OTP sent
   to the owner's phone — that they're aware of the replacement search. On success
   we record an auditable consent (`setOwnerConsent`) keyed to the owner's number
   and run `onVerified()` so the group upgrades its trust cue.

   Mirrors AadhaarVerifyModal (mock OTP: any 6 digits) but the number belongs to
   the owner, not the current user, so it's shown read-only and never editable. */
export default function OwnerConsentModal({ ownerMobile, byMobile, onClose, onVerified }) {
  const owner = String(ownerMobile || '').replace(/\D/g, '').slice(0, 10);
  const [verifying, setVerifying] = useState(false);
  const otp = useOtpFlow();

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const submit = (e) => {
    e.preventDefault();
    if (!otp.otpSent) { otp.send(); return; }
    if (otp.otp.length !== 6) { otp.setOtpError(true); return; }
    setVerifying(true);
    setTimeout(() => {
      setOwnerConsent(owner, byMobile);
      setVerifying(false);
      onVerified?.();
      onClose();
    }, 800);
  };

  return createPortal((
    <div
      className="pn-modal-backdrop"
      style={{ zIndex: 300 }}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm the flat owner's consent"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="pn-modal">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center"><Icon name="badge-check" className="w-5 h-5 text-teal-400" /></div>
            <div>
              <h3 className="text-lg font-bold text-white">Confirm the owner's consent</h3>
              <p className="text-xs text-slate-400 mt-0.5">We'll text the flat owner a code to confirm they're aware you're seeking a replacement.</p>
            </div>
          </div>
          <button onClick={onClose} className="pn-modal-x" aria-label="Close"><Icon name="x" className="w-5 h-5" /></button>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-slate-400 mb-4 flex items-start gap-2">
          <Icon name="lock" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-teal-400" /> Consent keeps replacement listings honest — the owner is never charged and their number is never shown to seekers.
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Flat owner's mobile</label>
            <div className="flex items-center gap-3 h-[52px] px-4 rounded-xl border border-white/10 bg-white/[0.04]">
              <span className="inline-flex items-center gap-1.5 text-sm text-slate-400 select-none"><span className="text-base leading-none">🇮🇳</span> +91</span>
              <span className="text-sm text-white font-medium tracking-wide flex-1">{owner}</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-teal-300"><Icon name="badge-check" className="w-3.5 h-3.5" /> Owner</span>
            </div>
            <p className="text-slate-500 text-xs mt-2">The consent OTP is sent to the owner at {fmtPhone(owner)}.</p>
          </div>

          {otp.otpSent && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 text-center">Enter the owner's OTP <span className="text-slate-600">(demo: any 6 digits)</span></label>
              <p className="text-xs text-slate-500 mb-4 text-center">Ask the owner for the 6-digit code we sent to <span className="text-teal-400 font-medium">+91 {owner}</span></p>
              <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); }} error={otp.otpError} />
              {otp.otpError && <p className="text-red-400 text-xs text-center mt-2">Please enter the complete 6-digit OTP</p>}
              <div className="flex items-center justify-center gap-2 text-sm mt-4">
                <span className="text-slate-500">Owner didn't get it?</span>
                <button type="button" onClick={otp.resend} disabled={!otp.canResend} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
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
