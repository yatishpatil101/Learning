import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight, CheckCircle2, Loader2, Send, User, Mail } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import MobileField from '../MobileField.jsx';
import OtpBoxes from './OtpBoxes.jsx';
import TurnstileWidget from '../security/TurnstileWidget.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useMobileInput } from '../../lib/hooks.js';
import { useOtpFlow } from './useOtpFlow.js';
import { sendOtp as sendOtpSvc } from '../../services/authService.js';
import { classifyOtpVerifyError } from '../../lib/otpVerifyError.js';
import { healStaleShell } from '../../lib/seamErrors.js';
import useBackToClose from '../../hooks/useBackToClose.js';

const INLINE_OTP_FORM_ID = 'inline-otp-form';

export default function InlineOtpSheet({ open, reason = 'contact', title: titleText, subtitle, onClose, onVerified }) {
  const { t } = useTranslation();
  const { login, update } = useAuth();
  const mobile = useMobileInput('');
  const turnstileRef = useRef(null);
  const otp = useOtpFlow((m) => sendOtpSvc({ mobile: m, turnstileToken: turnstileRef.current }));
  const setMobileValue = mobile.setValue;
  const resetOtp = otp.reset;
  const [mobileErr, setMobileErr] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profileErrs, setProfileErrs] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const verifiedUser = useRef(null);
  const submittingRef = useRef(false);
  const verifyMessage = verifyError ? t(verifyError.messageKey, { count: verifyError.count }) : null;
  const otpSpent = verifyError?.terminal === true;
  const otpCanBeRenewed = !otpSpent || verifyError?.resendable === true;
  const busy = otp.sending || verifying || saving;
  const title = titleText || t(`auth.intent.${reason}Heading`);

  useBackToClose(open, onClose, { key: '__dzInlineOtpGate' });

  useEffect(() => {
    if (open) return;
    setMobileValue('');
    resetOtp();
    setMobileErr(false);
    setVerifying(false);
    setVerifyError(null);
    setNeedsProfile(false);
    setName('');
    setEmail('');
    setProfileErrs({});
    setSaving(false);
    setSaveError(null);
    verifiedUser.current = null;
    submittingRef.current = false;
  }, [open, resetOtp, setMobileValue]);

  const sendOtp = async () => {
    if (busy || submittingRef.current) return;
    if (!mobile.valid) {
      setMobileErr(true);
      return;
    }
    setMobileErr(false);
    setVerifyError(null);
    submittingRef.current = true;
    try {
      await otp.send(mobile.value);
    } finally {
      submittingRef.current = false;
    }
  };

  const verify = async () => {
    if (busy || otpSpent || submittingRef.current) return;
    if (otp.otp.length < 6) {
      otp.setOtpError(true);
      return;
    }
    submittingRef.current = true;
    setVerifying(true);
    setVerifyError(null);
    try {
      const who = await login({ mobile: mobile.value, otp: otp.otp, remember: true });
      if (who && !who.name?.trim()) {
        verifiedUser.current = who;
        setNeedsProfile(true);
        return;
      }
      onVerified?.(who);
    } catch (err) {
      setVerifyError(classifyOtpVerifyError(err));
      healStaleShell(err);
    } finally {
      submittingRef.current = false;
      setVerifying(false);
    }
  };

  const saveProfile = async () => {
    if (saving || submittingRef.current) return;
    const next = {};
    const nameVal = name.trim();
    const emailVal = email.trim();
    if (nameVal.length < 2 || nameVal.length > 80) next.name = true;
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) next.email = true;
    setProfileErrs(next);
    if (Object.keys(next).length) return;
    submittingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const patch = { name: nameVal };
      if (emailVal) patch.email = emailVal;
      const who = await update(patch);
      onVerified?.(who || verifiedUser.current);
    } catch (err) {
      setSaveError(err?.status === 409 ? t('auth.errEmailTaken') : t('common.somethingWentWrong'));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const changeNumber = () => {
    if (busy) return;
    otp.reset();
    setVerifyError(null);
    setNeedsProfile(false);
  };

  const status = otp.otpError || otp.sendError || verifyMessage
    ? (otp.otpError ? t('auth.errOtp') : (otp.sendError ? t(otp.sendError) : verifyMessage))
    : '';

  const submit = (e) => {
    e.preventDefault();
    if (needsProfile) {
      saveProfile();
      return;
    }
    if (otp.otpSent) {
      verify();
      return;
    }
    sendOtp();
  };

  const footer = needsProfile ? (
    <button type="submit" form={INLINE_OTP_FORM_ID} disabled={saving} className="dz-auth-submit btn-teal w-full min-h-[48px] rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2 disabled:opacity-60">
      {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('auth.savingProfile')}</> : <>{t('auth.completeProfileCta')} <ArrowRight className="w-4 h-4" /></>}
    </button>
  ) : otp.otpSent ? (
    <button type="submit" form={INLINE_OTP_FORM_ID} disabled={verifying || otpSpent} aria-describedby={otpSpent ? 'inline-otp-status' : undefined} className="dz-auth-submit btn-teal w-full min-h-[48px] rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2 disabled:opacity-60">
      {verifying ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('auth.verifying')}</> : <>{t('auth.verifyAndSignIn')} <ArrowRight className="w-4 h-4" /></>}
    </button>
  ) : (
    <button type="submit" form={INLINE_OTP_FORM_ID} disabled={otp.sending} className="send-otp-btn w-full min-h-[48px] rounded-xl border border-teal-400/30 bg-teal-400/10 text-teal-300 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
      {otp.sending ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('auth.sending')}</> : <><Send className="w-4 h-4" /> {t('auth.sendOtp')}</>}
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title={title} footer={footer} size="sm">
      <form id={INLINE_OTP_FORM_ID} onSubmit={submit} className="space-y-5">
        {needsProfile ? (
          <>
          <div className="text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-sm text-gray-400">{t('auth.completeProfileSub')}</p>
          </div>
          <div>
            <label htmlFor="inline-profile-name" className="block text-sm font-medium text-gray-300 mb-2">{t('auth.fullName')} <span className="text-rose-400">*</span></label>
            <div className="relative">
              <User className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input id="inline-profile-name" autoComplete="name" enterKeyHint="next" maxLength={80} aria-invalid={!!profileErrs.name} value={name} onChange={(e) => { setName(e.target.value); setProfileErrs((x) => ({ ...x, name: false })); }} type="text" placeholder={t('auth.fullNamePlaceholder')} className={'w-full pl-10 pr-4 py-3.5 bg-white/5 border rounded-xl text-white text-base placeholder-gray-500 focus:outline-none transition-all ' + (profileErrs.name ? 'border-red-400' : 'border-white/10 focus:border-teal-400')} />
            </div>
            {profileErrs.name ? <p role="alert" className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errName')}</p> : null}
          </div>
          <div>
            <label htmlFor="inline-profile-email" className="block text-sm font-medium text-gray-300 mb-2">{t('auth.email')} <span className="text-gray-500 font-normal">{t('auth.emailOptional')}</span></label>
            <div className="relative">
              <Mail className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input id="inline-profile-email" autoComplete="email" enterKeyHint="done" aria-invalid={!!profileErrs.email} value={email} onChange={(e) => { setEmail(e.target.value); setProfileErrs((x) => ({ ...x, email: false })); }} type="email" placeholder={t('auth.emailPlaceholder')} className={'w-full pl-10 pr-4 py-3.5 bg-white/5 border rounded-xl text-white text-base placeholder-gray-500 focus:outline-none transition-all ' + (profileErrs.email ? 'border-red-400' : 'border-white/10 focus:border-teal-400')} />
            </div>
            {profileErrs.email ? <p role="alert" className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errEmail')}</p> : null}
          </div>
          {saveError ? <p role="alert" className="text-red-400 text-xs text-center">{saveError}</p> : null}
          </>
        ) : (
          <>
          <p className="text-sm text-gray-400">{subtitle || t(`auth.intent.${reason}Sub`)}</p>
          <div className={'input-group' + (mobileErr ? ' error' : '')}>
            <label htmlFor="inline-otp-mobile" className="block text-sm font-medium text-gray-300 mb-2">{t('auth.mobileNumber')} <span className="text-rose-400">*</span></label>
            <MobileField id="inline-otp-mobile" autoFocus enterKeyHint="send" value={mobile.value} onChange={(v) => { if (v !== mobile.value && otp.otpSent) otp.reset(); mobile.setValue(v); setMobileErr(false); setVerifyError(null); }} error={mobileErr} disabled={otp.sending || verifying} placeholder={t('auth.mobilePlaceholder')} inputClassName="!text-base" />
            {mobileErr ? <p className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errMobile')}</p> : null}
          </div>
          <p role="alert" id="inline-otp-status" className={status ? 'text-red-400 text-xs text-center' : 'sr-only'}>{status}</p>
          {!otp.otpSent ? (
            <>
              <TurnstileWidget onToken={(tok) => { turnstileRef.current = tok; }} className="flex justify-center" />
              <p className="text-[11px] leading-relaxed text-gray-500">
                <Trans
                  i18nKey="auth.inlineOtpTerms"
                  components={{
                    1: <Link to="/terms" className="text-teal-400 hover:text-teal-300" />,
                    3: <Link to="/privacy" className="text-teal-400 hover:text-teal-300" />,
                  }}
                />
              </p>
            </>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('auth.enterOtp')}</label>
                <p className="text-xs text-gray-500 mb-4">{t('auth.otpSentTo')} <span className="text-teal-400 font-medium">+91 {mobile.value}</span></p>
              </div>
              <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); if (!otpSpent) setVerifyError(null); }} error={otp.otpError || !!verifyError} />
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
                <button type="button" onClick={async () => { if (await otp.resend(mobile.value)) setVerifyError(null); }} disabled={!otp.canResend || otp.sending || !otpCanBeRenewed} className="min-h-[44px] px-2 text-teal-400 hover:text-teal-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {otp.canResend ? t('auth.resendOtp') : t('auth.resendIn', { seconds: otp.seconds })}
                </button>
                <button type="button" onClick={changeNumber} disabled={busy} className="min-h-[44px] px-2 text-gray-400 hover:text-gray-200 font-semibold transition-colors disabled:opacity-40">
                  {t('auth.changeNumber')}
                </button>
              </div>
            </div>
          )}
          </>
        )}
      </form>
    </Modal>
  );
}
