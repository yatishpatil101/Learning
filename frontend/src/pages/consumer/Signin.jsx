import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, BadgeCheck, CheckCircle2, Home, Loader2, Send, ShieldCheck, Smartphone, Star, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { userExists, findUser } from '../../lib/auth.js';
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
function LeftPanel() {
  const { city } = useCity();
  const hasData = cityHasData(city);
  const spot = popularFor(city)[4] || popularFor(city)[0] || null;
  const stats = hasData
    ? [[STATS.properties, 'Properties'], [STATS.verifiedOwners, 'Verified Owners'], [STATS.localities, 'Localities']]
    : [[STATS.brokerage, 'Brokerage'], ['100%', 'Verified'], ['RERA', 'Compliant']];

  return (
    <>
      <div className="flex items-center gap-3 mb-10">
        <div className="w-12 h-12 bg-gradient-to-br from-teal-400 to-teal-600 rounded-2xl flex items-center justify-center">
          <Home className="w-6 h-6 text-white" />
        </div>
        <span className="text-3xl font-bold text-white">PuneNest</span>
      </div>
      <h1 className="text-4xl font-extrabold text-white leading-tight mb-4">
        Find Your Perfect{' '}
        <RotatingNoun wordClassName="gradient-text" />{' '}
        <span className="gradient-text">in {city}</span>
      </h1>
      <p className="text-gray-400 text-lg mb-10 leading-relaxed">
        {hasData
          ? `Join thousands of buyers, tenants and owners who trust PuneNest for homes, commercial spaces and plots across ${city}.`
          : `PuneNest is launching in ${city} soon — sign in to get first access to verified, zero-brokerage homes.`}
      </p>
      <div className="glass-card rounded-2xl p-6 mb-10">
        <div className="flex items-center gap-1 mb-3">
          {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400" />)}
        </div>
        <p className="text-gray-300 text-sm leading-relaxed italic mb-4">
          {hasData && spot
            ? `"PuneNest made our home-buying journey effortless. Found our dream home in ${spot} within weeks. The platform is intuitive and the listings are genuine."`
            : `"PuneNest's zero-brokerage, RERA-verified model is exactly what ${city} needs. Signing up early was a no-brainer."`}
        </p>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-sm">RP</div>
          <div>
            <p className="text-white text-sm font-semibold">Ravi Patil</p>
            <p className="text-gray-500 text-xs">{hasData && spot ? `Homeowner, ${spot}` : `Early member, ${city}`}</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {stats.map(([n, l]) => (
          <div key={l} className="stat-card rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold gradient-text">{n}</p>
            <p className="text-gray-500 text-xs mt-1">{l}</p>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Signin() {
  const { login } = useAuth();
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
  const otp = useOtpFlow();

  const sendOtp = () => {
    if (!mobile.valid) { setMobileErr(true); return; }
    setMobileErr(false);
    // No account for this number yet — carry the mobile (and the gate reason/next)
    // over to Sign Up so the visitor finishes registering instead of hitting a dead
    // end. When sign-ups are turned off there's no Sign Up screen to send them to, so
    // we just proceed with OTP here (mock auth — any number is allowed to sign in).
    if (signupsOn && !userExists(mobile.value)) {
      const qs = new URLSearchParams({ mobile: mobile.value, new: '1' });
      if (params.get('next')) qs.set('next', params.get('next'));
      if (params.get('reason')) qs.set('reason', params.get('reason'));
      navigate(`/signup?${qs.toString()}`);
      return;
    }
    otp.send();
  };

  const submit = (e) => {
    e.preventDefault();
    if (!mobile.valid) { setMobileErr(true); return; }
    if (!otp.otpSent) { sendOtp(); return; }
    if (otp.otp.length < 6) { otp.setOtpError(true); return; }
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      setDone(true);
      const acct = findUser(mobile.value);
      login({ name: acct?.name || 'PuneNest Member', mobile: mobile.value, role: acct?.role || 'buyer', remember });
      setTimeout(() => navigate(postAuthDest(params), { replace: true }), 1000);
    }, 1400);
  };

  const { city } = useCity();
  const cityKnown = cityHasData(city);
  const mobileIntro = (
    <MobileAuthIntro
      eyebrow={cityKnown ? `Live in ${city}` : `Launching in ${city}`}
      tagline={cityKnown
        ? `Sign in to reach verified owners across ${city} — zero brokerage.`
        : `Sign in for first access to verified, zero-brokerage homes in ${city}.`}
      chips={[[ShieldCheck, 'RERA-verified'], [BadgeCheck, 'Zero brokerage'], [Users, 'Owner-direct']]}
    />
  );

  return (
    <AuthShell left={<LeftPanel />} mobileIntro={mobileIntro}>
      <div className="auth-card glass-card rounded-2xl p-6 sm:p-8 lg:p-10 slide-up">
        <div className="text-center mb-6 sm:mb-8 slide-up slide-up-delay-1">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-teal-400/20 to-teal-600/20 rounded-2xl flex items-center justify-center mx-auto mb-3.5 sm:mb-4 border border-teal-400/20">
            <Smartphone className="w-6 h-6 sm:w-7 sm:h-7 text-teal-400" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">{intent.heading}</h2>
          <p className="text-gray-400 text-sm">{intent.sub}</p>
        </div>

        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className={'input-group slide-up slide-up-delay-2' + (mobileErr ? ' error' : '')}>
            <label htmlFor="signin-mobile" className="block text-sm font-medium text-gray-300 mb-2">Mobile Number <span className="text-rose-400">*</span></label>
            <MobileField id="signin-mobile" autoFocus value={mobile.value} onChange={(v) => { mobile.setValue(v); setMobileErr(false); }} error={mobileErr} placeholder="Enter mobile number" />
            {mobileErr ? <p className="text-red-400 text-xs mt-1.5 ml-1">Please enter a valid 10-digit mobile number</p> : null}
          </div>

          {!otp.otpSent ? (
            <button type="button" onClick={sendOtp} disabled={otp.sending} className="send-otp-btn w-full py-3 rounded-xl text-teal-400 font-semibold text-sm flex items-center justify-center gap-2">
              <Send className="w-4 h-4" /> {otp.sending ? 'Sending…' : 'Send OTP'}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <label className="block text-sm font-medium text-gray-300 mb-1">Enter OTP</label>
                <p className="text-xs text-gray-500 mb-4">We've sent a 6-digit code via SMS to <span className="text-teal-400 font-medium">+91 {mobile.value}</span></p>
              </div>
              <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); }} error={otp.otpError} />
              {otp.otpError ? <p className="text-red-400 text-xs text-center">Please enter the complete 6-digit OTP</p> : null}
              <p className="text-[11px] text-gray-600 text-center">Demo mode — enter any 6 digits to continue.</p>
              <div className="flex items-center justify-center gap-2 text-sm">
                <span className="text-gray-500">Didn't receive it?</span>
                <button type="button" onClick={otp.resend} disabled={!otp.canResend} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {otp.canResend ? 'Resend OTP' : `Resend in ${otp.seconds}s`}
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2.5 cursor-pointer group">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-teal-500 w-4 h-4" />
              <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">Remember this device</span>
            </label>
            <Link to="/contact" className="text-sm text-teal-400 hover:text-teal-300 transition-colors font-medium">Need Help?</Link>
          </div>

          {otp.otpSent ? (
            <button type="submit" disabled={verifying || done} className="btn-teal w-full py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2" style={done ? { background: 'linear-gradient(135deg,#059669,#10b981)' } : undefined}>
              {done ? <><CheckCircle2 className="w-5 h-5" /> Verified! Redirecting…</>
                : verifying ? <><Loader2 className="w-5 h-5 animate-spin" /> Verifying…</>
                : <>Verify &amp; Sign In <ArrowRight className="w-4 h-4" /></>}
            </button>
          ) : null}
        </form>

        {signupsOn ? (
          <p className="text-center text-sm text-gray-500 mt-7">
            Don't have an account?
            <Link to="/signup" className="text-teal-400 hover:text-teal-300 font-semibold transition-colors ml-1">Sign Up</Link>
          </p>
        ) : (
          <p className="text-center text-sm text-gray-500 mt-7">
            New to PuneNest? Just enter your number above — we'll set you up.
          </p>
        )}
      </div>
    </AuthShell>
  );
}
