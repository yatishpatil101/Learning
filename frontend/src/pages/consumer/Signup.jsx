import { useEffect, useRef, useState } from 'react';
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
import { classifyOtpVerifyError } from '../../lib/otpVerifyError.js';
import { healStaleShell } from '../../lib/seamErrors.js';
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
  /* See Signin.jsx: the confirmation is held for a second before the redirect, during which the
     live navbar is still clickable — so the timer has to be cancellable. */
  const redirectTimer = useRef(null);
  useEffect(() => () => clearTimeout(redirectTimer.current), []);
  // See Signin.jsx: a ref rather than state, because a re-render can throw away a solved challenge.
  const turnstileRef = useRef(null);
  const otp = useOtpFlow((m) => sendOtpSvc({ mobile: m, turnstileToken: turnstileRef.current }));
  const [createError, setCreateError] = useState(null);
  /* True once the refusal is one a fresh code cannot fix. Separate from the message, which is
     cleared on the next keystroke — the whole point is that more typing cannot help. */
  const [otpSpent, setOtpSpent] = useState(false);
  const [otpCanBeRenewed, setOtpCanBeRenewed] = useState(true);
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
    if (otpSpent) return;
    if (otp.otp.length < 6) { otp.setOtpError(true); return; }
    setCreating(true);
    setCreateError(null);
    try {
      const wasNew = await register({
        name: name.trim() || 'Draazy User',
        mobile: mobile.value,
        email: email.trim(),
        role,
        otp: otp.otp,
      });
      setDone(true);
      const ref = params.get('ref');
      if (ref) {
        /* Attribution is the server's job. Un-awaited and silent on failure: a 409 means a code the
           person who just signed up neither chose nor can fix — see the flow doc, § Sign up. */
        redeemReferral(ref, 'link').catch(() => {});
      }
      /* Keyed on `wasNew`, not on "this is the sign-up screen": a mobile that already has an
         account passes straight through `register`, and both doors must agree on a destination. */
      redirectTimer.current = setTimeout(
        () => navigate(postAuthDest(params, wasNew ? '/listings' : '/dashboard'), { replace: true }),
        1000,
      );
    } catch (err) {
      /* A validation rejection names the field to fix, so its server text is kept verbatim; every
         other refusal is translated. Split on status, since some carry no count. */
      if (err?.isValidation) {
        setCreateError(err.message || t('common.somethingWentWrong'));
        return;
      }
      const { messageKey, count, terminal, resendable } = classifyOtpVerifyError(err);
      setCreateError(t(messageKey, { count }));
      setOtpSpent(terminal);
      setOtpCanBeRenewed(!terminal || resendable === true);
      // Set the message FIRST: if a reload starts, it is never read; if the heal is refused, it is.
      healStaleShell(err);
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
            <MobileField id="signup-mobile" enterKeyHint="send" value={mobile.value} onChange={(v) => { if (v !== mobile.value && otp.otpSent) { otp.reset(); setCreateError(null); setOtpSpent(false); setOtpCanBeRenewed(true); } mobile.setValue(v); setErrs((x) => ({ ...x, mobile: false })); }} error={errs.mobile} disabled={otp.sending || creating} placeholder={t('auth.mobilePlaceholder')} />
            {errs.mobile ? <p className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errMobile')}</p> : null}
          </div>

          <p id="signup-otp-status" role="alert" className={otp.otpError || otp.sendError || createError ? 'text-red-400 text-xs text-center' : 'sr-only'}>{otp.otpError ? t('auth.errOtp') : (otp.sendError ? t(otp.sendError) : createError)}</p>

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
            </>
          ) : (
            <>
              <div className="space-y-4">
                <div className="text-center">
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('auth.enterOtp')}</label>
                  <p className="text-xs text-gray-500 mb-4">{t('auth.otpSentTo')} <span className="text-teal-400 font-medium">+91 {mobile.value}</span></p>
                </div>
                <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); if (!otpSpent) setCreateError(null); }} error={otp.otpError || !!createError} />
                <div className="flex items-center justify-center gap-2 text-sm">
                  <span className="text-gray-500">{t('auth.didntReceive')}</span>
                  <button type="button" onClick={async () => { if (await otp.resend(mobile.value)) { setCreateError(null); setOtpSpent(false); setOtpCanBeRenewed(true); } }} disabled={!otp.canResend || otp.sending || !otpCanBeRenewed} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {otp.canResend ? t('auth.resendOtp') : t('auth.resendIn', { seconds: otp.seconds })}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={creating || done || otpSpent} className="dz-auth-submit btn-teal w-full py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2" style={done ? { background: 'linear-gradient(135deg,#059669,#10b981)' } : undefined}>
                {done ? <><CheckCircle2 className="w-5 h-5" /> {t('auth.accountCreated')}</>
                  : creating ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('auth.creatingAccount')}</>
                  : <>{t('auth.createAccount')} <ArrowRight className="w-4 h-4" /></>}
              </button>
            </>
          )}
        </form>

        <p className="text-center text-sm text-gray-500 mt-7">
          {t('auth.haveAccount')}
          <Link to={params.toString() ? `/signin?${params}` : '/signin'} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors ml-1">{t('auth.signIn')}</Link>
        </p>
      </div>
    </AuthShell>
  );
}
