import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BadgeCheck, CheckCircle2, IndianRupee, Loader2, Send, ShieldCheck, Smartphone, Star, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { userExists, findUser } from '../../lib/auth.js';
import { sendOtp as sendOtpSvc } from '../../services/authService.js';
import { isHttpDomain } from '../../services/config.js';
import { useMobileInput } from '../../lib/hooks.js';
import MobileField from '../../components/MobileField.jsx';
import { useOtpFlow } from '../../components/auth/useOtpFlow.js';
import OtpBoxes from '../../components/auth/OtpBoxes.jsx';
import AuthShell from '../../components/auth/AuthShell.jsx';
import MobileAuthIntro from '../../components/auth/MobileAuthIntro.jsx';
import RotatingNoun from '../../components/RotatingNoun.jsx';
import { useCity } from '../../context/CityContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { resolveAuthIntent, postAuthDest } from '../../lib/authIntent.js';
import { cityHasData } from '../../lib/geoConfig.js';
import { STATS, popularFor } from '../../data/homeData.js';

// City-aware marketing panel: mirrors the home page's city awareness so the copy,
// stats and testimonial reflect the active city instead of hardcoding Pune. Cities
// we don't have inventory for yet ("launched-empty" / coming-soon) get honest
// "launching soon" copy and generic-but-true claims instead of Pune numbers.
// The three claims that make PuneNest hard to copy — stated plainly, not sold.
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
  const { login } = useAuth();
  const authIsLive = isHttpDomain('auth');
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
  const otp = useOtpFlow((m) => sendOtpSvc({ mobile: m }));
  const [verifyError, setVerifyError] = useState(null);

  const sendOtp = () => {
    if (!mobile.valid) { setMobileErr(true); return; }
    setMobileErr(false);
    // No account for this number yet — carry the mobile (and the gate reason/next)
    // over to Sign Up so the visitor finishes registering instead of hitting a dead
    // end. When sign-ups are turned off there's no Sign Up screen to send them to, so
    // we just proceed with OTP here (mock auth — any number is allowed to sign in).
    //
    // Only meaningful on mocks: the live API provisions an account on first verified
    // login, and has deliberately no "does this mobile exist?" endpoint — answering
    // that publicly would be a user-enumeration oracle.
    if (!authIsLive && signupsOn && !userExists(mobile.value)) {
      const qs = new URLSearchParams({ mobile: mobile.value, new: '1' });
      if (params.get('next')) qs.set('next', params.get('next'));
      if (params.get('reason')) qs.set('reason', params.get('reason'));
      navigate(`/signup?${qs.toString()}`);
      return;
    }
    otp.send(mobile.value);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!mobile.valid) { setMobileErr(true); return; }
    if (!otp.otpSent) { sendOtp(); return; }
    if (otp.otp.length < 6) { otp.setOtpError(true); return; }
    setVerifying(true);
    setVerifyError(null);
    try {
      // On mocks the account details come from the local registry; against the live API the
      // server owns the profile and returns it, so these hints are simply ignored.
      const acct = authIsLive ? null : findUser(mobile.value);
      await login({
        name: acct?.name || 'PuneNest Member',
        mobile: mobile.value,
        role: acct?.role || 'buyer',
        otp: otp.otp,
        remember,
      });
      setDone(true);
      setTimeout(() => navigate(postAuthDest(params), { replace: true }), 1000);
    } catch (err) {
      setVerifyError(err?.message || 'That code did not work. Please try again.');
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
            <MobileField id="signin-mobile" autoFocus enterKeyHint="send" value={mobile.value} onChange={(v) => { mobile.setValue(v); setMobileErr(false); }} error={mobileErr} placeholder={t('auth.mobilePlaceholder')} />
            {mobileErr ? <p className="text-red-400 text-xs mt-1.5 ml-1">{t('auth.errMobile')}</p> : null}
          </div>

          {!otp.otpSent ? (
            <>
              <button type="button" onClick={sendOtp} disabled={otp.sending} className="send-otp-btn w-full py-3 rounded-xl text-teal-400 font-semibold text-sm flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> {otp.sending ? t('auth.sending') : t('auth.sendOtp')}
              </button>
              {otp.sendError ? <p className="text-red-400 text-xs text-center">{otp.sendError}</p> : null}
            </>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('auth.enterOtp')}</label>
                <p className="text-xs text-gray-500 mb-4">{t('auth.otpSentTo')} <span className="text-teal-400 font-medium">+91 {mobile.value}</span></p>
              </div>
              <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); setVerifyError(null); }} error={otp.otpError || !!verifyError} />
              {otp.otpError ? <p className="text-red-400 text-xs text-center">{t('auth.errOtp')}</p> : null}
              {verifyError ? <p className="text-red-400 text-xs text-center">{verifyError}</p> : null}
              {otp.sendError ? <p className="text-red-400 text-xs text-center">{otp.sendError}</p> : null}
              {authIsLive ? null : <p className="text-[11px] text-gray-600 text-center">{t('auth.demoMode')}</p>}
              <div className="flex items-center justify-center gap-2 text-sm">
                <span className="text-gray-500">{t('auth.didntReceive')}</span>
                <button type="button" onClick={() => otp.resend(mobile.value)} disabled={!otp.canResend} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
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
            <button type="submit" disabled={verifying || done} className="pn-auth-submit btn-teal w-full py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2" style={done ? { background: 'linear-gradient(135deg,#059669,#10b981)' } : undefined}>
              {done ? <><CheckCircle2 className="w-5 h-5" /> {t('auth.verifiedRedirecting')}</>
                : verifying ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('auth.verifying')}</>
                : <>{t('auth.verifyAndSignIn')} <ArrowRight className="w-4 h-4" /></>}
            </button>
          ) : null}
        </form>

        {signupsOn ? (
          <p className="text-center text-sm text-gray-500 mt-7">
            {t('auth.noAccount')}
            <Link to="/signup" className="text-teal-400 hover:text-teal-300 font-semibold transition-colors ml-1">{t('auth.signUp')}</Link>
          </p>
        ) : (
          <p className="text-center text-sm text-gray-500 mt-7">
            {t('auth.newToPuneNest')}
          </p>
        )}
      </div>
    </AuthShell>
  );
}
