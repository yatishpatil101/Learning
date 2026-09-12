import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BadgeCheck, CheckCircle2, IndianRupee, Loader2, Mail, Send, ShieldCheck, Smartphone, Star, User, UserCircle, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { sendOtp as sendOtpSvc } from '../../services/authService.js';
import { useMobileInput } from '../../lib/hooks.js';
import MobileField from '../../components/MobileField.jsx';
import { useOtpFlow } from '../../components/auth/useOtpFlow.js';
import OtpBoxes from '../../components/auth/OtpBoxes.jsx';
import AuthShell from '../../components/auth/AuthShell.jsx';
import MobileAuthIntro from '../../components/auth/MobileAuthIntro.jsx';
import TurnstileWidget from '../../components/security/TurnstileWidget.jsx';
import RotatingNoun from '../../components/RotatingNoun.jsx';
import { useCity } from '../../context/CityContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { resolveAuthIntent, postAuthDest } from '../../lib/authIntent.js';
import { classifyOtpVerifyError } from '../../lib/otpVerifyError.js';
import { cityHasData } from '../../lib/geoConfig.js';
import { STATS, popularFor } from '../../data/homeData.js';

// City-aware marketing panel: a city with no inventory yet gets "launching soon" copy and
// generic-but-true claims, never Pune's numbers.
const MOAT = [
  [IndianRupee, 'auth.moatZeroBrokerage'],
  [ShieldCheck, 'auth.moatRera'],
  [Users, 'auth.moatOwnerDirect'],
];

function LeftPanel() {
  const { t } = useTranslation();
  const { city } = useCity();
  const hasData = cityHasData(city);
  const spot = popularFor(city)[4] || popularFor(city)[0] || null;
  const stats = hasData
    ? [[STATS.properties, 'auth.statProperties'], [STATS.verifiedOwners, 'auth.statVerifiedOwners'], [STATS.localities, 'auth.statLocalities']]
    : [[STATS.brokerage, 'auth.statBrokerage'], ['100%', 'auth.statVerified'], ['RERA', 'auth.statCompliant']];

  return (
    <>
      <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/[.08] px-3.5 py-1.5 mt-6 mb-6">
        <span className="auth-live-dot inline-block w-1.5 h-1.5 rounded-full bg-teal-300" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-200">
          {hasData ? t('auth.marketplaceEyebrow', { city }) : t('auth.launchingSoon', { city })}
        </span>
      </div>
      <h1 className="text-4xl font-extrabold text-white leading-tight mb-4">
        {t('auth.signinTitle')}{' '}
        <RotatingNoun wordClassName="gradient-text" />{' '}
        <span className="gradient-text">{t('auth.signinTitleCity', { city })}</span>
      </h1>
      <p className="text-gray-400 text-lg mb-6 leading-relaxed">
        {hasData ? t('auth.signinBlurb', { city }) : t('auth.signinBlurbSoon', { city })}
      </p>
      <div className="flex flex-wrap gap-2 mb-8">
        {MOAT.map(([Ic, key]) => (
          <span key={key} className="inline-flex items-center gap-1.5 rounded-full border border-white/[.08] bg-white/[.04] px-3 py-1.5 text-[13px] font-medium text-gray-200">
            <Ic className="w-4 h-4 text-teal-300" /> {t(key)}
          </span>
        ))}
      </div>
      <div className="glass-card rounded-2xl p-6 mb-8">
        <div className="flex items-center gap-1 mb-3">
          {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400" />)}
        </div>
        <p className="text-gray-300 text-sm leading-relaxed italic mb-4">
          {hasData && spot ? t('auth.testimonial', { spot }) : t('auth.testimonialSoon', { city })}
        </p>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-sm">RP</div>
          <div>
            <p className="text-white text-sm font-semibold">{t('auth.testimonialName')}</p>
            <p className="text-gray-500 text-xs">
              {hasData && spot ? t('auth.testimonialRole', { spot }) : t('auth.testimonialRoleSoon', { city })}
            </p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {stats.map(([n, key]) => (
          <div key={key} className="stat-card rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold gradient-text">{n}</p>
            <p className="text-gray-500 text-xs mt-1">{t(key)}</p>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Signin() {
  const { t } = useTranslation();
  const { login, update } = useAuth();
  const { flagEnabled } = useAppFlags();
  const signupsOn = flagEnabled('signupsEnabled');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const intent = resolveAuthIntent(params);
  const mobile = useMobileInput(params.get('mobile') || '');
  const [mobileErr, setMobileErr] = useState(false);
  const [remember, setRemember] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [done, setDone] = useState(false);
  // A ref, not state: re-rendering the form when Turnstile solves or expires a challenge can
  // discard a solved one and make the user sit through another.
  const turnstileRef = useRef(null);
  const otp = useOtpFlow((m) => sendOtpSvc({ mobile: m, turnstileToken: turnstileRef.current }));
  /* Only a refusal a fresh code cannot fix blocks the form — a busy limiter or a dropped
     connection leaves the guess intact and must stay retryable. */
  const [verifyError, setVerifyError] = useState(null);
  const otpSpent = verifyError?.terminal === true;
  const otpCanBeRenewed = !otpSpent || verifyError?.resendable === true;
  const verifyMessage = verifyError
    ? t(verifyError.messageKey, { count: verifyError.count })
    : null;
  // Step 3 — collected only from an account the server provisioned without a name. See `submit`.
  const [needsProfile, setNeedsProfile] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profileErrs, setProfileErrs] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  /* The confirmation is held on screen for a second, during which the live navbar is still
     clickable — so the timer has to be cancellable. See the flow doc, § Sign in. */
  const redirectTimer = useRef(null);
  useEffect(() => () => clearTimeout(redirectTimer.current), []);
  const redirectTo = (to) => {
    redirectTimer.current = setTimeout(() => navigate(to, { replace: true }), 1000);
  };

  const sendOtp = () => {
    if (!mobile.valid) { setMobileErr(true); return; }
    setMobileErr(false);
    /* No `userExists(mobile)` check: a public "does this mobile have an account?" answer is a
       user-enumeration oracle, and the server provisions on first verified login anyway. */
    otp.send(mobile.value);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!mobile.valid) { setMobileErr(true); return; }
    if (!otp.otpSent) { sendOtp(); return; }
    // The disabled button is presentation, not enforcement — Enter still submits a form whose
    // button is disabled in some browsers, and this code can only be refused.
    if (otpSpent) return;
    if (otp.otp.length < 6) { otp.setOtpError(true); return; }
    setVerifying(true);
    setVerifyError(null);
    try {
      const who = await login({ mobile: mobile.value, otp: otp.otp, remember });
      /* A blank name is how a nameless provisioned account announces itself, asked for only after
         the code proved the number. `who &&`, so a broken login contract is not read as that. */
      if (who && !who.name?.trim()) { setNeedsProfile(true); return; }
      setDone(true);
      redirectTo(postAuthDest(params));
    } catch (err) {
      setVerifyError(classifyOtpVerifyError(err));
    } finally {
      setVerifying(false);
    }
  };

  const { city } = useCity();
  const cityKnown = cityHasData(city);
  const mobileIntro = (
    <MobileAuthIntro
      eyebrow={cityKnown ? t('auth.liveIn', { city }) : t('auth.launchingIn', { city })}
      tagline={cityKnown ? t('auth.signinTagline', { city }) : t('auth.signinTaglineSoon', { city })}
      chips={[[ShieldCheck, t('auth.moatRera')], [BadgeCheck, t('auth.moatZeroBrokerage')], [Users, t('auth.moatOwnerDirect')]]}
    />
  );

  const saveProfile = async (e) => {
    e.preventDefault();
    const errs = {};
    /* Both ends, matching `UserUpdate`'s `@Size(min = 2, max = 80)`: this step has no way out, so
       a bound the server enforces and the form does not strands the user. */
    const nameVal = name.trim();
    if (nameVal.length < 2 || nameVal.length > 80) errs.name = true;
    const emailVal = email.trim();
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) errs.email = true;
    setProfileErrs(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Email is omitted rather than sent blank: PATCH treats a present field as an overwrite,
      // so `email: ''` would erase an address on the retry path.
      const patch = { name: nameVal };
      if (emailVal) patch.email = emailVal;
      await update(patch);
      setDone(true);
      /* Only this branch knows the account is seconds old, so only it can say the dashboard would
         be a wall of zeros. A `next` still wins over the listings fallback. */
      redirectTo(postAuthDest(params, '/listings'));
    } catch (err) {
      /* Read the STATUS, never `err.message`: the server speaks English and this form is
         trilingual. 409 earns its own line as the only failure the user can act on. */
      setSaveError(err?.status === 409 ? t('auth.errEmailTaken') : t('common.somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };

  if (needsProfile) {
    return (
      <AuthShell left={<LeftPanel />} mobileIntro={mobileIntro}>
        <div className="auth-card glass-card rounded-2xl p-6 sm:p-8 lg:p-10 slide-up">
          <div className="text-center mb-6 sm:mb-8 slide-up slide-up-delay-1">
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-teal-400/20 to-teal-600/20 rounded-2xl flex items-center justify-center mx-auto mb-3.5 sm:mb-4 border border-teal-400/20">
              <UserCircle className="w-6 h-6 sm:w-7 sm:h-7 text-teal-400" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">{t('auth.completeProfileTitle')}</h2>
            <p className="text-gray-400 text-sm">{t('auth.completeProfileSub')}</p>
          </div>

          <form onSubmit={saveProfile} className="space-y-5" noValidate>
            <div className="slide-up slide-up-delay-2">
              <label htmlFor="profile-name" className="block text-sm font-medium text-gray-300 mb-2">{t('auth.fullName')} <span className="text-rose-400">*</span></label>
              <div className="relative">
                <User className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input id="profile-name" autoFocus autoComplete="name" enterKeyHint="next" maxLength={80} aria-invalid={!!profileErrs.name} aria-describedby={profileErrs.name ? 'profile-name-err' : undefined} value={name} onChange={(e) => { setName(e.target.value); setProfileErrs((x) => ({ ...x, name: false })); }} type="text" placeholder={t('auth.fullNamePlaceholder')} className={'w-full pl-10 pr-4 py-3.5 bg-white/5 border rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none transition-all ' + (profileErrs.name ? 'border-red-400' : 'border-white/10 focus:border-teal-400')} />
              </div>
              {profileErrs.name ? <p id="profile-name-err" role="alert" className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errName')}</p> : null}
            </div>

            <div className="slide-up slide-up-delay-3">
              <label htmlFor="profile-email" className="block text-sm font-medium text-gray-300 mb-2">{t('auth.email')} <span className="text-gray-500 font-normal">{t('auth.emailOptional')}</span></label>
              <div className="relative">
                <Mail className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input id="profile-email" autoComplete="email" enterKeyHint="done" aria-invalid={!!profileErrs.email} aria-describedby={profileErrs.email ? 'profile-email-err' : undefined} value={email} onChange={(e) => { setEmail(e.target.value); setProfileErrs((x) => ({ ...x, email: false })); }} type="email" placeholder={t('auth.emailPlaceholder')} className={'w-full pl-10 pr-4 py-3.5 bg-white/5 border rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none transition-all ' + (profileErrs.email ? 'border-red-400' : 'border-white/10 focus:border-teal-400')} />
              </div>
              {profileErrs.email ? <p id="profile-email-err" role="alert" className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errEmail')}</p> : null}
            </div>

            {saveError ? <p role="alert" className="text-red-400 text-xs text-center">{saveError}</p> : null}

            <button type="submit" disabled={saving || done} className="dz-auth-submit btn-teal w-full py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2" style={done ? { background: 'linear-gradient(135deg,#059669,#10b981)' } : undefined}>
              {done ? <><CheckCircle2 className="w-5 h-5" /> {t('auth.accountCreated')}</>
                : saving ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('auth.savingProfile')}</>
                : <>{t('auth.completeProfileCta')} <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell left={<LeftPanel />} mobileIntro={mobileIntro}>
      <div className="auth-card glass-card rounded-2xl p-6 sm:p-8 lg:p-10 slide-up">
        <div className="text-center mb-6 sm:mb-8 slide-up slide-up-delay-1">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-teal-400/20 to-teal-600/20 rounded-2xl flex items-center justify-center mx-auto mb-3.5 sm:mb-4 border border-teal-400/20">
            <Smartphone className="w-6 h-6 sm:w-7 sm:h-7 text-teal-400" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">{t(intent.headingKey)}</h2>
          <p className="text-gray-400 text-sm">{t(intent.subKey)}</p>
        </div>

        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className={'input-group slide-up slide-up-delay-2' + (mobileErr ? ' error' : '')}>
            <label htmlFor="signin-mobile" className="block text-sm font-medium text-gray-300 mb-2">{t('auth.mobileNumber')} <span className="text-rose-400">*</span></label>
            <MobileField id="signin-mobile" autoFocus enterKeyHint="send" value={mobile.value} onChange={(v) => { if (v !== mobile.value && otp.otpSent) otp.reset(); mobile.setValue(v); setMobileErr(false); setVerifyError(null); }} error={mobileErr} disabled={otp.sending || verifying} placeholder={t('auth.mobilePlaceholder')} />
            {mobileErr ? <p className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errMobile')}</p> : null}
          </div>

          {/* This alert remains mounted from the first OTP request through verification, so all
              delivery and verification failures reach the same assistive-technology channel. */}
            <p role="alert" id="signin-otp-status" className={otp.otpError || otp.sendError || verifyMessage ? 'text-red-400 text-xs text-center' : 'sr-only'}>{otp.otpError ? t('auth.errOtp') : otp.sendError || verifyMessage}</p>

          {!otp.otpSent ? (
            <>
              {/* Renders nothing unless VITE_TURNSTILE_SITE_KEY is set, and the send button is not
                  gated on a token — the server alone decides whether the challenge is required. */}
              <TurnstileWidget onToken={(tok) => { turnstileRef.current = tok; }} className="flex justify-center" />
              <button type="button" onClick={sendOtp} disabled={otp.sending} className="send-otp-btn w-full py-3 rounded-xl text-teal-400 font-semibold text-sm flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> {otp.sending ? t('auth.sending') : t('auth.sendOtp')}
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('auth.enterOtp')}</label>
                <p className="text-xs text-gray-500 mb-4">{t('auth.otpSentTo')} <span className="text-teal-400 font-medium">+91 {mobile.value}</span></p>
              </div>
              {/* Typing clears an ordinary error but not the spent-code blocker: only a fresh code
                  can help, so hiding the message would walk the user back into a refusal. */}
              <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); if (!otpSpent) setVerifyError(null); }} error={otp.otpError || !!verifyError} />
              <div className="flex items-center justify-center gap-2 text-sm">
                <span className="text-gray-500">{t('auth.didntReceive')}</span>
                {/* Cleared only once a code has really been sent: clearing on click would re-enable
                    the form against the dead code whenever the resend itself is refused. */}
                <button type="button" onClick={async () => { if (await otp.resend(mobile.value)) setVerifyError(null); }} disabled={!otp.canResend || otp.sending || !otpCanBeRenewed} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {otp.canResend ? t('auth.resendOtp') : t('auth.resendIn', { seconds: otp.seconds })}
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <label className="tap-target sm:min-h-0 sm:min-w-0 flex items-center gap-2.5 cursor-pointer group">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-teal-500 w-4 h-4" />
              <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">{t('auth.rememberDevice')}</span>
            </label>
            <Link to="/contact" className="tap-target sm:min-h-0 sm:min-w-0 inline-flex items-center text-sm text-teal-400 hover:text-teal-300 transition-colors font-medium">{t('auth.needHelp')}</Link>
          </div>

          {otp.otpSent ? (
            <button type="submit" disabled={verifying || done || otpSpent} aria-describedby={otpSpent ? 'signin-otp-status' : undefined} className="dz-auth-submit btn-teal w-full py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2" style={done ? { background: 'linear-gradient(135deg,#059669,#10b981)' } : undefined}>
              {done ? <><CheckCircle2 className="w-5 h-5" /> {t('auth.verifiedRedirecting')}</>
                : verifying ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('auth.verifying')}</>
                : <>{t('auth.verifyAndSignIn')} <ArrowRight className="w-4 h-4" /></>}
            </button>
          ) : null}
        </form>

        {signupsOn ? (
          <p className="text-center text-sm text-gray-500 mt-7">
            {t('auth.noAccount')}
            {/* Carries the whole query string: Signup calls the same `postAuthDest(params)`, so a
                bare `/signup` link would drop the destination the sender chose. */}
            <Link to={params.toString() ? `/signup?${params}` : '/signup'} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors ml-1">{t('auth.signUp')}</Link>
          </p>
        ) : (
          <p className="text-center text-sm text-gray-500 mt-7">
            {t('auth.newToDraazy')}
          </p>
        )}
      </div>
    </AuthShell>
  );
}
