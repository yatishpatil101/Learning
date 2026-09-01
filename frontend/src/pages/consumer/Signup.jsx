import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight, BadgeCheck, Bell, CalendarCheck, CheckCircle2, Loader2, Mail, Send, ShieldCheck, User, UserCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useMobileInput } from '../../lib/hooks.js';
import MobileField from '../../components/MobileField.jsx';
import { useOtpFlow } from '../../components/auth/useOtpFlow.js';
import { sendOtp as sendOtpSvc } from '../../services/authService.js';
import OtpBoxes from '../../components/auth/OtpBoxes.jsx';
import AuthShell from '../../components/auth/AuthShell.jsx';
import MobileAuthIntro from '../../components/auth/MobileAuthIntro.jsx';
import TurnstileWidget from '../../components/security/TurnstileWidget.jsx';
import RotatingNoun from '../../components/RotatingNoun.jsx';
import { useCity } from '../../context/CityContext.jsx';
import { cityHasData } from '../../lib/geoConfig.js';
import { resolveAuthIntent, postAuthDest } from '../../lib/authIntent.js';
import { redeemReferral } from '../../services/referralService.js';

const BENEFITS = [
  [Bell, 'auth.benefitAlertsTitle', 'auth.benefitAlertsDesc'],
  [ShieldCheck, 'auth.benefitReraTitle', 'auth.benefitReraDesc'],
  [CalendarCheck, 'auth.benefitVisitsTitle', 'auth.benefitVisitsDesc'],
];

function LeftPanel() {
  const { t } = useTranslation();
  const { city } = useCity();
  const hasData = cityHasData(city);
  return (
    <>
      <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/[.08] px-3.5 py-1.5 mt-6 mb-6">
        <span className="auth-live-dot inline-block w-1.5 h-1.5 rounded-full bg-teal-300" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-200">
          {hasData ? t('auth.marketplaceEyebrow', { city }) : t('auth.launchingSoon', { city })}
        </span>
      </div>
      <h1 className="text-4xl font-extrabold text-white leading-tight mb-4">
        {t('auth.signupTitleLead')}{' '}
        <span className="gradient-text">{t('auth.signupTitleAccent', { city })}</span>{' '}
        <RotatingNoun words={['Homes', 'Offices', 'Shops', 'Plots']} wordClassName="gradient-text" />
      </h1>
      <p className="text-gray-400 text-lg mb-10 leading-relaxed">
        {t('auth.signupBlurbLead')}{' '}
        <span className="text-teal-300 font-medium">{t('auth.signupBlurbAccent')}</span>{' '}
        {t('auth.signupBlurbTail')}
      </p>
      <div className="space-y-4">
        {BENEFITS.map(([Ic, titleKey, descKey]) => (
          <div key={titleKey} className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-400/15 border border-teal-400/20 flex items-center justify-center flex-shrink-0">
              <Ic className="w-4 h-4 text-teal-400" />
            </div>
            <p className="text-gray-300 text-sm">{t(descKey)}</p>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Signup() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const intent = resolveAuthIntent(params);
  const [role] = useState('buyer');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const mobile = useMobileInput(params.get('mobile') || '');
  // Set when Sign In redirects a visitor here because no account matched their number.
  const isNew = params.get('new') === '1';
  const [errs, setErrs] = useState({});
  const [terms, setTerms] = useState(false);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);
  // See Signin.jsx: a ref rather than state, because a re-render can throw away a solved challenge.
  const turnstileRef = useRef(null);
  const otp = useOtpFlow((m) => sendOtpSvc({ mobile: m, turnstileToken: turnstileRef.current }));
  const [createError, setCreateError] = useState(null);
  const { city } = useCity();
  const cityKnown = cityHasData(city);
  const mobileIntro = (
    <MobileAuthIntro
      eyebrow={cityKnown ? t('auth.liveIn', { city }) : t('auth.launchingIn', { city })}
      tagline={t('auth.signupTagline', { city })}
      chips={BENEFITS.map(([Ic, titleKey]) => [Ic, t(titleKey)])}
    />
  );

  const validateBase = () => {
    const e = {};
    if (name.trim().length < 2) e.name = true;
    const emailVal = email.trim();
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) e.email = true;
    if (!mobile.valid) e.mobile = true;
    if (!terms) e.terms = true;
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const sendOtp = () => {
    if (!validateBase()) return;
    otp.send(mobile.value);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validateBase()) return;
    if (!otp.otpSent) { otp.send(mobile.value); return; }
    if (otp.otp.length < 6) { otp.setOtpError(true); return; }
    setCreating(true);
    setCreateError(null);
    try {
      await register({
        name: name.trim() || 'Draazy User',
        mobile: mobile.value,
        email: email.trim(),
        role,
        otp: otp.otp,
      });
      setDone(true);
      const ref = params.get('ref');
      if (ref) {
        /* Tell whoever is serving, and only them. This line used to be preceded by a direct
           `setReferredBy(ref)` into the mock store, which ran on every build: a live sign-up wrote
           `dzReferredBy:<mobile>`, a key nothing on a live build reads, beside the call that does
           the real attributing. That local write belonged to the mock's answer to this same
           request, so it moved below the seam and went with the mock (P5c). This page does not
           reach past the seam to do it.

           On a live build that leaves `POST /referrals/redeem`, which had shipped since V23 with
           nothing ever calling it — so `ReferralQualification`'s hook — a
           referral credits the referrer when the referee's first listing passes ownership
           verification, "the only qualifying action a browser cannot fake" — had never fired for a
           real user, and the fraud desk at the far end had only ever reviewed seed rows.

           This used to be accompanied by `creditReferrerForJoin()`, which queued the referrer's
           +15 contacts into a browser-side ledger. That is gone: the reward is derived from the
           qualified referral this call creates, so the same act now grants it once, on the server,
           where a clawback can take it back.

           Deliberately not awaited and deliberately silent on failure. The account has already been
           created and the success screen is up; a 409 here means the code was unknown, was the
           caller's own, or had already been redeemed by this account, and none of those are
           actionable by the person who just signed up — they did not choose the code and cannot fix
           it. Blocking the redirect on it, or showing them an error about it, would make somebody
           else's bad link into their problem.

           `shareChannel: 'link'` because that is how a `?ref=` arrives. D60 says the field is
           unvalidated on purpose: it is an attribution statistic, and a wrong value is worse as a
           400 than as slightly muddy data. */
        redeemReferral(ref, 'link').catch(() => {});
      }
      setTimeout(() => navigate(postAuthDest(params), { replace: true }), 1000);
    } catch (err) {
      setCreateError(err?.message || 'We could not create your account. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <AuthShell left={<LeftPanel />} mobileIntro={mobileIntro} align="top">
      <div className="auth-card glass-card rounded-2xl p-6 sm:p-8 lg:p-10 slide-up">
        <div className="text-center mb-6 sm:mb-8 slide-up slide-up-delay-1">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-teal-400/20 to-teal-600/20 rounded-2xl flex items-center justify-center mx-auto mb-3.5 sm:mb-4 border border-teal-400/20">
            <UserCircle className="w-6 h-6 sm:w-7 sm:h-7 text-teal-400" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">{t('auth.createAccount')}</h2>
          <p className="text-gray-400 text-sm">{t('auth.createAccountSub')}</p>
        </div>

        {isNew ? (
          <div className="mb-6 rounded-xl border border-teal-500/20 bg-teal-500/[0.07] p-3.5 flex gap-3 slide-up slide-up-delay-1">
            <BadgeCheck className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
            <p className="text-teal-100/90 text-xs leading-relaxed">
              {t('auth.newHereBanner')}
            </p>
          </div>
        ) : !intent.isDefault ? (
          <div className="mb-6 rounded-xl border border-teal-500/20 bg-teal-500/[0.07] p-3.5 flex gap-3 slide-up slide-up-delay-1">
            <BadgeCheck className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
            <p className="text-teal-100/90 text-xs leading-relaxed">
              <span className="font-semibold">{t(intent.headingKey)}.</span> {t(intent.subKey)}
            </p>
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className="slide-up slide-up-delay-2">
            <label htmlFor="signup-name" className="block text-sm font-medium text-gray-300 mb-2">{t('auth.fullName')} <span className="text-rose-400">*</span></label>
            <div className="relative">
              <User className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input id="signup-name" autoFocus autoComplete="name" enterKeyHint="next" value={name} onChange={(e) => { setName(e.target.value); setErrs((x) => ({ ...x, name: false })); }} type="text" placeholder={t('auth.fullNamePlaceholder')} className={'w-full pl-10 pr-4 py-3.5 bg-white/5 border rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none transition-all ' + (errs.name ? 'border-red-400' : 'border-white/10 focus:border-teal-400')} />
            </div>
            {errs.name ? <p className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errName')}</p> : null}
          </div>

          <div className="slide-up slide-up-delay-3">
            <label htmlFor="signup-email" className="block text-sm font-medium text-gray-300 mb-2">{t('auth.email')} <span className="text-gray-500 font-normal">{t('auth.emailOptional')}</span></label>
            <div className="relative">
              <Mail className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input id="signup-email" autoComplete="email" enterKeyHint="next" value={email} onChange={(e) => { setEmail(e.target.value); setErrs((x) => ({ ...x, email: false })); }} type="email" placeholder={t('auth.emailPlaceholder')} className={'w-full pl-10 pr-4 py-3.5 bg-white/5 border rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none transition-all ' + (errs.email ? 'border-red-400' : 'border-white/10 focus:border-teal-400')} />
            </div>
            {errs.email ? <p className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errEmail')}</p> : null}
          </div>

          <div className="slide-up slide-up-delay-3">
            <label htmlFor="signup-mobile" className="block text-sm font-medium text-gray-300 mb-2">{t('auth.mobileNumber')} <span className="text-rose-400">*</span></label>
            <MobileField id="signup-mobile" enterKeyHint="send" value={mobile.value} onChange={(v) => { mobile.setValue(v); setErrs((x) => ({ ...x, mobile: false })); }} error={errs.mobile} placeholder={t('auth.mobilePlaceholder')} />
            {errs.mobile ? <p className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errMobile')}</p> : null}
          </div>

          <div>
            <label className="tap-target sm:min-h-0 sm:min-w-0 flex items-start gap-2.5 cursor-pointer group">
              <input type="checkbox" checked={terms} onChange={(e) => { setTerms(e.target.checked); setErrs((x) => ({ ...x, terms: false })); }} className="accent-teal-500 w-5 h-5 sm:w-4 sm:h-4 mt-0.5" />
              <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                <Trans
                  i18nKey="auth.termsAgree"
                  components={{
                    1: <Link to="/terms" className="text-teal-400 hover:text-teal-300" />,
                    3: <Link to="/privacy" className="text-teal-400 hover:text-teal-300" />,
                  }}
                />
              </span>
            </label>
            {errs.terms ? <p className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errTerms')}</p> : null}
          </div>

          {!otp.otpSent ? (
            <>
              {/* Inert without VITE_TURNSTILE_SITE_KEY. Not gating the button — see Signin.jsx. */}
              <TurnstileWidget onToken={(tok) => { turnstileRef.current = tok; }} className="flex justify-center" />
              <button type="button" onClick={sendOtp} disabled={otp.sending} className="send-otp-btn w-full py-3 rounded-xl text-teal-400 font-semibold text-sm flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> {otp.sending ? t('auth.sending') : t('auth.sendOtp')}
              </button>
              {otp.sendError ? <p className="text-red-400 text-xs text-center">{otp.sendError}</p> : null}
            </>
          ) : (
            <>
              <div className="space-y-4">
                <div className="text-center">
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('auth.enterOtp')}</label>
                  <p className="text-xs text-gray-500 mb-4">{t('auth.otpSentTo')} <span className="text-teal-400 font-medium">+91 {mobile.value}</span></p>
                </div>
                <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); setCreateError(null); }} error={otp.otpError || !!createError} />
                {otp.otpError ? <p className="text-red-400 text-xs text-center">{t('auth.errOtp')}</p> : null}
                {createError ? <p className="text-red-400 text-xs text-center">{createError}</p> : null}
                {otp.sendError ? <p className="text-red-400 text-xs text-center">{otp.sendError}</p> : null}
                <div className="flex items-center justify-center gap-2 text-sm">
                  <span className="text-gray-500">{t('auth.didntReceive')}</span>
                  <button type="button" onClick={() => otp.resend(mobile.value)} disabled={!otp.canResend} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {otp.canResend ? t('auth.resendOtp') : t('auth.resendIn', { seconds: otp.seconds })}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={creating || done} className="dz-auth-submit btn-teal w-full py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2" style={done ? { background: 'linear-gradient(135deg,#059669,#10b981)' } : undefined}>
                {done ? <><CheckCircle2 className="w-5 h-5" /> {t('auth.accountCreated')}</>
                  : creating ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('auth.creatingAccount')}</>
                  : <>{t('auth.createAccount')} <ArrowRight className="w-4 h-4" /></>}
              </button>
            </>
          )}
        </form>

        <p className="text-center text-sm text-gray-500 mt-7">
          {t('auth.haveAccount')}
          <Link to="/signin" className="text-teal-400 hover:text-teal-300 font-semibold transition-colors ml-1">{t('auth.signIn')}</Link>
        </p>
      </div>
    </AuthShell>
  );
}
