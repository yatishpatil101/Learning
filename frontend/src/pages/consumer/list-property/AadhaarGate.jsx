import { Lock, ShieldCheck, AlertTriangle, UserCheck, Send, Check } from 'lucide-react';
import { lbl } from './styles.js';
import MobileField from '../../../components/MobileField.jsx';
import OtpBoxes from '../../../components/auth/OtpBoxes.jsx';

export default function AadhaarGate({ ctx }) {
  const {
    t, gateMismatch, gateOtpSent, enforceSignInMobile, signedMobile, fmtMobile,
    sendGateOtp, gateSending, setGateMismatch, reloginWithAadhaar,
    gateMobile, setGateMobile, setGateMobileErr, gateMobileErr,
    gateOtp, setGateOtp, setGateOtpErr, gateOtpErr, verifyGateOtp, gateVerifying, resendGateOtp,
  } = ctx;
  return (
    <div className="glass-card rounded-2xl p-6 sm:p-8 mb-8">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-teal-300 mb-3">
        <Lock className="w-3 h-3" /> {t('listProperty.gate.stepRequired')}
      </span>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-11 h-11 rounded-xl bg-teal-400/15 flex items-center justify-center flex-shrink-0">
          <ShieldCheck className="w-6 h-6 text-teal-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">{t('listProperty.gate.verifyTitle')}</h2>
          <p className="text-gray-500 text-xs">{t('listProperty.gate.verifySub')}</p>
        </div>
      </div>

      {gateMismatch ? (
        /* Owner says the signed-in number isn't their Aadhaar mobile. */
        <div className="mt-5 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-amber-200 mb-1">{t('listProperty.gate.mismatchTitle')}</h3>
              <p className="text-xs text-amber-100/80 leading-relaxed">
                {t('listProperty.gate.mismatchBodyPre')} <strong className="text-amber-100">+91 {fmtMobile(signedMobile)}</strong>. {t('listProperty.gate.mismatchBodyPost')}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mt-4">
                <button type="button" onClick={reloginWithAadhaar}
                  className="btn-teal px-6 py-3 rounded-xl text-white font-semibold text-sm inline-flex items-center justify-center gap-2">
                  <UserCheck className="w-4 h-4" /> {t('listProperty.gate.signInAadhaar')}
                </button>
                <button type="button" onClick={() => setGateMismatch(false)}
                  className="btn-outline px-6 py-3 rounded-xl text-gray-300 font-semibold text-sm">
                  {t('listProperty.back')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : !gateOtpSent ? (
        /* Confirm stage — the number is pre-filled from sign-in. */
        enforceSignInMobile ? (
          <div className="mt-5">
            <label className={lbl}>{t('listProperty.gate.yourAadhaarMobile')}</label>
            <div className="flex items-center gap-3 h-[52px] px-4 rounded-xl border border-white/10 bg-white/[0.04]">
              <span className="inline-flex items-center gap-1.5 text-sm text-gray-400 select-none">
                <span className="text-base leading-none">🇮🇳</span> +91
              </span>
              <span className="text-white font-semibold tracking-wide text-base">{fmtMobile(signedMobile)}</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500 whitespace-nowrap">
                <UserCheck className="w-3.5 h-3.5 text-teal-400" /> {t('listProperty.gate.signedIn')}
              </span>
            </div>
            <p className="text-gray-500 text-xs mt-2">{t('listProperty.gate.otpSentHere')}</p>

            <p className="text-sm text-gray-200 font-medium mt-5 mb-3">{t('listProperty.gate.isThisAadhaar')}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button type="button" onClick={sendGateOtp} disabled={gateSending}
                className="btn-teal px-6 py-3.5 rounded-xl text-white font-semibold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap">
                <Send className="w-4 h-4" /> {gateSending ? t('listProperty.gate.sending') : t('listProperty.gate.yesSendOtp')}
              </button>
              <button type="button" onClick={() => setGateMismatch(true)}
                className="btn-outline px-6 py-3.5 rounded-xl text-gray-300 font-semibold text-sm">
                {t('listProperty.gate.noDifferent')}
              </button>
            </div>
          </div>
        ) : (
          /* Defensive fallback: no valid signed-in number to pin to. */
          <div className="mt-5">
            <label className={lbl}>{t('listProperty.gate.aadhaarMobileReq')}</label>
            <div className="flex flex-col sm:flex-row gap-3">
              <MobileField value={gateMobile} onChange={(v) => { setGateMobile(v); setGateMobileErr(false); }} error={gateMobileErr} placeholder={t('listProperty.gate.aadhaarLinkedMobilePh')} className="flex-1" />
              <button type="button" onClick={sendGateOtp} disabled={gateSending}
                className="btn-teal px-6 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 whitespace-nowrap">
                <Send className="w-4 h-4" /> {gateSending ? t('listProperty.gate.sending') : t('listProperty.gate.sendOtp')}
              </button>
            </div>
            {gateMobileErr && <p className="text-red-400 text-xs mt-2">{t('listProperty.gate.enterValidMobile')}</p>}
          </div>
        )
      ) : (
        /* OTP stage — centred boxes with a full-width verify action. */
        <div className="mt-6">
          <label className={`${lbl} mb-1`}>{t('listProperty.gate.enterOtp')}</label>
          <p className="text-gray-500 text-xs mb-4">{t('listProperty.gate.otpSentTo', { mobile: fmtMobile(gateMobile) })}</p>
          <OtpBoxes value={gateOtp} onChange={(v) => { setGateOtp(v); setGateOtpErr(false); }} error={gateOtpErr} />
          {gateOtpErr && <p className="text-red-400 text-xs mt-3 text-center">{t('listProperty.gate.enter6Otp')}</p>}
          <button type="button" onClick={verifyGateOtp} disabled={gateVerifying}
            className="btn-teal w-full mt-5 px-6 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2">
            <Check className="w-4 h-4" /> {gateVerifying ? t('listProperty.gate.verifying') : t('listProperty.gate.verifyContinue')}
          </button>
          <p className="text-center text-gray-500 text-xs mt-3">
            {t('listProperty.gate.didntGet')}{' '}
            <button type="button" onClick={resendGateOtp} className="text-teal-400 hover:text-teal-300 font-medium">{t('listProperty.gate.resend')}</button>
          </p>
        </div>
      )}
    </div>
  );
}