import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router';
import Icon from '../Icon.jsx';
import MobileField, { isValidMobile } from '../MobileField.jsx';
import OtpBoxes from './OtpBoxes.jsx';
import { useOtpFlow } from './useOtpFlow.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { setAadhaarVerified } from '../../lib/store.js';

/* Blanket Aadhaar identity gate for contacting owners.
   Any owner-contact action (requesting the number or sending an enquiry) requires
   the tenant/buyer to be Aadhaar-verified first. This popup verifies the
   Aadhaar-linked mobile via OTP (mock: any 6 digits) and, on success, records the
   verification (`setAadhaarVerified`) and runs `onVerified()` to resume the action.

   One Aadhaar maps to one mobile, so — like the List Property gate — we pin
   verification to the number the user signed in with when it's valid, and fall back
   to a manual entry only if no valid signed-in number exists. */
export default function AadhaarVerifyModal({
  onClose,
  onVerified,
  subtitle = 'Only Aadhaar-verified users can contact owners on PuneNest.',
  note = 'We verify the mobile number linked to your Aadhaar via OTP. Your number is never shown to owners — it keeps every enquiry genuine.',
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const signedMobile = String(user?.mobile || '').replace(/\D/g, '').slice(0, 10);
  const pinned = isValidMobile(signedMobile);

  const [mobile, setMobile] = useState(signedMobile);
  const [mobileErr, setMobileErr] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // Owner says the signed-in number isn't their Aadhaar-linked one — one Aadhaar maps
  // to one mobile, so we route them back to sign in with the correct number.
  const [mismatch, setMismatch] = useState(false);
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

  const sendOtp = () => {
    if (!isValidMobile(mobile)) {
      setMobileErr(true);
      return;
    }
    setMobileErr(false);
    otp.send();
  };

  const submit = (e) => {
    e.preventDefault();
    if (!otp.otpSent) {
      sendOtp();
      return;
    }
    if (otp.otp.length !== 6) {
      otp.setOtpError(true);
      return;
    }
    setVerifying(true);
    setTimeout(() => {
      setAadhaarVerified(mobile);
      setVerifying(false);
      onVerified?.();
      onClose();
    }, 800);
  };

  const reloginWithAadhaar = () => {
    onClose();
    logout();
    navigate('/signin?next=' + encodeURIComponent(location.pathname + location.search));
  };

  // Portal to <body> so the popup escapes any transformed / backdrop-filtered
  // ancestor (e.g. the glass owner card or the contact modal), which would
  // otherwise trap its position:fixed in a local stacking context and let the
  // navbar paint over it.
  return createPortal((
    <div
      className="pn-modal-backdrop"
      style={{ zIndex: 300 }}
      role="dialog"
      aria-modal="true"
      aria-label="Verify your identity with Aadhaar"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="pn-modal">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center"><Icon name="shield-check" className="w-5 h-5 text-teal-400" /></div>
            <div>
              <h3 className="text-lg font-bold text-white">Verify your identity to continue</h3>
              <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="pn-modal-x" aria-label="Close"><Icon name="x" className="w-5 h-5" /></button>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-slate-400 mb-4 flex items-start gap-2">
          <Icon name="lock" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-teal-400" /> {note}
        </div>

        {mismatch ? (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
            <div className="flex items-start gap-3">
              <Icon name="alert-triangle" className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-amber-200 mb-1">Sign in with your Aadhaar-linked number</h4>
                <p className="text-xs text-amber-100/80 leading-relaxed">
                  Your Aadhaar is linked to exactly one mobile number, and that has to be the number you sign in with — it&rsquo;s how we keep every listing genuine and duplicate-free. You&rsquo;re signed in as <strong className="text-amber-100">+91 {signedMobile}</strong>. Sign in again with your Aadhaar-linked mobile to verify and continue.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 mt-4">
                  <button type="button" onClick={reloginWithAadhaar} className="btn-teal px-5 py-2.5 rounded-xl text-white font-semibold text-sm inline-flex items-center justify-center gap-2">
                    <Icon name="user-check" className="w-4 h-4" /> Sign in with Aadhaar-linked number
                  </button>
                  <button type="button" onClick={() => setMismatch(false)} className="btn-outline px-5 py-2.5 rounded-xl text-slate-300 font-semibold text-sm">Back</button>
                </div>
              </div>
            </div>
          </div>
        ) : (
        <form onSubmit={submit} className="space-y-4">
          {pinned ? (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Your Aadhaar-linked mobile</label>
              <div className="flex items-center gap-3 h-[52px] px-4 rounded-xl border border-white/10 bg-white/[0.04]">
                <span className="inline-flex items-center gap-1.5 text-sm text-slate-400 select-none"><span className="text-base leading-none">🇮🇳</span> +91</span>
                <span className="text-sm text-white font-medium tracking-wide flex-1">{signedMobile}</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-teal-300"><Icon name="user-check" className="w-3.5 h-3.5" /> Signed in</span>
              </div>
              <p className="text-slate-500 text-xs mt-2">The Aadhaar OTP will be sent to the number you signed in with.</p>
              {!otp.otpSent && (
                <>
                  <p className="text-sm text-slate-200 font-medium mt-5 mb-3">Is this the mobile number linked to your Aadhaar?</p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button type="button" onClick={sendOtp} disabled={otp.sending} className="btn-teal px-6 py-3 rounded-xl text-white font-semibold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap">
                      <Icon name="send" className="w-4 h-4" /> {otp.sending ? 'Sending…' : 'Yes, send OTP'}
                    </button>
                    <button type="button" onClick={() => setMismatch(true)} className="btn-outline px-6 py-3 rounded-xl text-slate-300 font-semibold text-sm">
                      No, it&rsquo;s a different number
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Aadhaar-registered Mobile Number <span className="text-rose-400">*</span></label>
              <MobileField value={mobile} onChange={(v) => { setMobile(v); setMobileErr(false); }} error={mobileErr} placeholder="Aadhaar-linked mobile" />
              {mobileErr && <p className="text-red-400 text-xs mt-1.5 ml-1">Please enter a valid 10-digit mobile number</p>}
            </div>
          )}

          {otp.otpSent && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 text-center">Enter OTP <span className="text-slate-600">(demo: any 6 digits)</span></label>
              <p className="text-xs text-slate-500 mb-4 text-center">We've sent a 6-digit code via SMS to <span className="text-teal-400 font-medium">+91 {mobile}</span></p>
              <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); }} error={otp.otpError} />
              {otp.otpError && <p className="text-red-400 text-xs text-center mt-2">Please enter the complete 6-digit OTP</p>}
              <div className="flex items-center justify-center gap-2 text-sm mt-4">
                <span className="text-slate-500">Didn't receive it?</span>
                <button type="button" onClick={otp.resend} disabled={!otp.canResend} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {otp.canResend ? 'Resend OTP' : `Resend in ${otp.seconds}s`}
                </button>
              </div>
            </div>
          )}

          {!(pinned && !otp.otpSent) && (
            <button type="submit" disabled={verifying || otp.sending} className="btn-teal w-full text-sm font-semibold text-white px-6 py-3 rounded-xl inline-flex items-center justify-center gap-2">
              {verifying && <><Icon name="loader-2" className="w-4 h-4 animate-spin" /> Verifying…</>}
              {!verifying && otp.sending && <><Icon name="loader-2" className="w-4 h-4 animate-spin" /> Sending…</>}
              {!verifying && !otp.sending && otp.otpSent && <><Icon name="check" className="w-4 h-4" /> Verify &amp; continue</>}
              {!verifying && !otp.sending && !otp.otpSent && <><Icon name="send" className="w-4 h-4" /> Send OTP</>}
            </button>
          )}
        </form>
        )}
      </div>
    </div>
  ), document.body);
}
