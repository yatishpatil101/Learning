import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import MobileField, { isValidMobile } from '../../../components/MobileField.jsx';
import OtpBoxes from '../../../components/auth/OtpBoxes.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';

export default function VerifyModal({ setVerifyOpen, submitVerify, verifyFormRef, mobile, mobileErr, setMobileErr, otp, verifying }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const signedMobile = String(user?.mobile || '').replace(/\D/g, '').slice(0, 10);
  const pinned = isValidMobile(signedMobile);
  // Seeker says the signed-in number isn't their Aadhaar-linked one — one Aadhaar maps to
  // one mobile, so we route them back to sign in with the correct number.
  const [mismatch, setMismatch] = useState(false);

  const reloginWithAadhaar = () => {
    setVerifyOpen(false);
    logout();
    navigate('/signin?next=' + encodeURIComponent(window.location.pathname));
  };

  return (
    <div className="sf-modal" onClick={() => setVerifyOpen(false)}>
      <div className="glass rounded-3xl w-full max-w-md p-6 sm:p-7" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center"><Icon name="shield-check" className="w-5 h-5 text-teal-400" /></div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('shareFlat.verifyModalTitle')}</h2>
              <p className="text-gray-400 text-xs mt-0.5">{t('shareFlat.verifyModalSubtitle')}</p>
            </div>
          </div>
          <button onClick={() => setVerifyOpen(false)} className="p-2 rounded-xl hover:bg-white/5 text-gray-400 hover:text-white"><Icon name="x" className="w-5 h-5" /></button>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] text-gray-400 mb-4 flex items-start gap-2">
          <Icon name="lock" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-teal-400" /> {t('shareFlat.verifyInfo')}
        </div>

        {mismatch ? (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
            <div className="flex items-start gap-3">
              <Icon name="alert-triangle" className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-amber-200 mb-1">{t('shareFlat.mismatchTitle')}</h4>
                <p className="text-xs text-amber-100/80 leading-relaxed">
                  {t('shareFlat.mismatchBodyPre')} <strong className="text-amber-100">+91 {signedMobile}</strong> {t('shareFlat.mismatchBodySuf')}
                </p>
                <div className="flex flex-col sm:flex-row gap-3 mt-4">
                  <button type="button" onClick={reloginWithAadhaar} className="btn-teal px-5 py-2.5 rounded-xl text-white font-semibold text-sm inline-flex items-center justify-center gap-2">
                    <Icon name="user-check" className="w-4 h-4" /> {t('shareFlat.signInAadhaar')}
                  </button>
                  <button type="button" onClick={() => setMismatch(false)} className="btn-outline px-5 py-2.5 rounded-xl text-gray-300 font-semibold text-sm">{t('shareFlat.back')}</button>
                </div>
              </div>
            </div>
          </div>
        ) : (
        <form onSubmit={submitVerify} className="space-y-4" ref={verifyFormRef}>
          {pinned && !otp.otpSent ? (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">{t('shareFlat.yourAadhaarMobile')}</label>
              <div className="flex items-center gap-3 h-[52px] px-4 rounded-xl border border-white/10 bg-white/[0.04]">
                <span className="inline-flex items-center gap-1.5 text-sm text-gray-400 select-none"><span className="text-base leading-none">🇮🇳</span> +91</span>
                <span className="text-sm text-white font-medium tracking-wide flex-1">{signedMobile}</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-teal-300"><Icon name="user-check" className="w-3.5 h-3.5" /> {t('shareFlat.signedIn')}</span>
              </div>
              <p className="text-gray-500 text-xs mt-2">{t('shareFlat.otpSentToNumber')}</p>
              <p className="text-sm text-gray-200 font-medium mt-5 mb-3">{t('shareFlat.isThisAadhaar')}</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button type="submit" disabled={verifying} className="btn-teal px-6 py-3 rounded-xl text-white font-semibold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap">
                  <Icon name="send" className="w-4 h-4" /> {t('shareFlat.yesSendOtp')}
                </button>
                <button type="button" onClick={() => setMismatch(true)} className="btn-outline px-6 py-3 rounded-xl text-gray-300 font-semibold text-sm">
                  {t('shareFlat.noDifferentNumber')}
                </button>
              </div>
            </div>
          ) : !otp.otpSent ? (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">{t('shareFlat.aadhaarMobileLabel')} <span className="text-rose-400">*</span></label>
              <MobileField value={mobile.value} onChange={(v) => { mobile.setValue(v); setMobileErr(false); }} error={mobileErr} placeholder={t('shareFlat.aadhaarMobilePlaceholder')} />
              {mobileErr && <p className="text-red-400 text-xs mt-1.5 ml-1">{t('shareFlat.invalidMobileFull')}</p>}
            </div>
          ) : null}
          {otp.otpSent && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 text-center">{t('shareFlat.enterOtp')} <span className="text-gray-600">{t('shareFlat.otpDemoHint')}</span></label>
              <p className="text-xs text-gray-500 mb-4 text-center">{t('shareFlat.otpSentSmsPre')} <span className="text-teal-400 font-medium">+91 {mobile.value}</span></p>
              <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); }} error={otp.otpError} />
              {otp.otpError && <p className="text-red-400 text-xs text-center mt-2">{t('shareFlat.otpIncomplete')}</p>}
              <div className="flex items-center justify-center gap-2 text-sm mt-4">
                <span className="text-gray-500">{t('shareFlat.didntReceive')}</span>
                <button type="button" onClick={otp.resend} disabled={!otp.canResend} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {otp.canResend ? t('shareFlat.resendOtp') : t('shareFlat.resendIn', { seconds: otp.seconds })}
                </button>
              </div>
            </div>
          )}
          {!(pinned && !otp.otpSent) && (
            <button type="submit" disabled={verifying} className="btn-teal w-full text-sm font-semibold text-white px-6 py-3 rounded-xl inline-flex items-center justify-center gap-2">
              {verifying ? <><Icon name="loader-2" className="w-4 h-4 animate-spin" /> {t('shareFlat.verifying')}</> : otp.otpSent ? <><Icon name="check" className="w-4 h-4" /> {t('shareFlat.verifyContinue')}</> : <><Icon name="send" className="w-4 h-4" /> {t('shareFlat.sendOtp')}</>}
            </button>
          )}
        </form>
        )}
      </div>
    </div>
  );
}
