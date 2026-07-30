import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, BadgeCheck, Bell, CalendarCheck, CheckCircle2, Loader2, Mail, Send, ShieldCheck, User, UserCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useMobileInput } from '../../lib/hooks.js';
import MobileField from '../../components/MobileField.jsx';
import { useOtpFlow } from '../../components/auth/useOtpFlow.js';
import { sendOtp as sendOtpSvc } from '../../services/authService.js';
import { isHttpDomain } from '../../services/config.js';
import OtpBoxes from '../../components/auth/OtpBoxes.jsx';
import AuthShell from '../../components/auth/AuthShell.jsx';
import MobileAuthIntro from '../../components/auth/MobileAuthIntro.jsx';
import RotatingNoun from '../../components/RotatingNoun.jsx';
import { useCity } from '../../context/CityContext.jsx';
import { cityHasData } from '../../lib/geoConfig.js';
import { resolveAuthIntent, postAuthDest } from '../../lib/authIntent.js';
import { setReferredBy } from '../../lib/store.js';

const BENEFITS = [
  [Bell, 'Instant alerts', 'Get notified the moment a matching home is listed.'],
  [ShieldCheck, 'RERA-compliant', 'Verified, RERA-compliant listings only.'],
  [CalendarCheck, 'Book visits', 'Book site visits in a single tap.'],
];

function LeftPanel() {
  const { city } = useCity();
  const hasData = cityHasData(city);
  return (
    <>
      <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/[.08] px-3.5 py-1.5 mt-6 mb-6">
        <span className="auth-live-dot inline-block w-1.5 h-1.5 rounded-full bg-teal-300" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-200">
          {hasData ? `${city}'s owner-direct marketplace` : `Launching in ${city} soon`}
        </span>
      </div>
      <h1 className="text-4xl font-extrabold text-white leading-tight mb-4">
        Create your account &amp;{' '}
        <span className="gradient-text">unlock {city}&apos;s best</span>{' '}
        <RotatingNoun words={['Homes', 'Offices', 'Shops', 'Plots']} wordClassName="gradient-text" />
      </h1>
      <p className="text-gray-400 text-lg mb-10 leading-relaxed">
        Save properties, set instant alerts, schedule visits and connect <span className="text-teal-300 font-medium">directly with verified owners</span> — no brokers, zero brokerage.
      </p>
      <div className="space-y-4">
        {BENEFITS.map(([Ic, title, desc]) => (
          <div key={title} className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-400/15 border border-teal-400/20 flex items-center justify-center flex-shrink-0">
              <Ic className="w-4 h-4 text-teal-400" />
            </div>
            <p className="text-gray-300 text-sm">{desc}</p>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Signup() {
  const { register } = useAuth();
  const authIsLive = isHttpDomain('auth');
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
  const otp = useOtpFlow((m) => sendOtpSvc({ mobile: m }));
  const [createError, setCreateError] = useState(null);
  const { city } = useCity();
  const cityKnown = cityHasData(city);
  const mobileIntro = (
    <MobileAuthIntro
      eyebrow={cityKnown ? `Live in ${city}` : `Launching in ${city}`}
      tagline={`Save homes, get instant alerts and book visits across ${city} — free, zero brokerage.`}
      chips={BENEFITS.map(([Ic, title]) => [Ic, title])}
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
        name: name.trim() || 'PuneNest User',
        mobile: mobile.value,
        email: email.trim(),
        role,
        otp: otp.otp,
      });
      setDone(true);
      const ref = params.get('ref');
      if (ref) setReferredBy(ref);
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
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">Create Account</h2>
          <p className="text-gray-400 text-sm">Sign up in seconds with your mobile number</p>
        </div>

        {isNew ? (
          <div className="mb-6 rounded-xl border border-teal-500/20 bg-teal-500/[0.07] p-3.5 flex gap-3 slide-up slide-up-delay-1">
            <BadgeCheck className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
            <p className="text-teal-100/90 text-xs leading-relaxed">
              Looks like you're new to PuneNest — we couldn't find an account for that number. Finish creating your account below to continue.
            </p>
          </div>
        ) : !intent.isDefault ? (
          <div className="mb-6 rounded-xl border border-teal-500/20 bg-teal-500/[0.07] p-3.5 flex gap-3 slide-up slide-up-delay-1">
            <BadgeCheck className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
            <p className="text-teal-100/90 text-xs leading-relaxed">
              <span className="font-semibold">{intent.heading}.</span> {intent.sub}
            </p>
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-5" noValidate>
          <div className="slide-up slide-up-delay-2">
            <label htmlFor="signup-name" className="block text-sm font-medium text-gray-300 mb-2">Full Name <span className="text-rose-400">*</span></label>
            <div className="relative">
              <User className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input id="signup-name" autoFocus autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setErrs((x) => ({ ...x, name: false })); }} type="text" placeholder="Enter your full name" className={'w-full pl-10 pr-4 py-3.5 bg-white/5 border rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none transition-all ' + (errs.name ? 'border-red-400' : 'border-white/10 focus:border-teal-400')} />
            </div>
            {errs.name ? <p className="text-red-400 text-xs mt-1.5 ml-1">Please enter your name</p> : null}
          </div>

          <div className="slide-up slide-up-delay-3">
            <label htmlFor="signup-email" className="block text-sm font-medium text-gray-300 mb-2">Email <span className="text-gray-500 font-normal">(optional)</span></label>
            <div className="relative">
              <Mail className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input id="signup-email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setErrs((x) => ({ ...x, email: false })); }} type="email" placeholder="you@example.com" className={'w-full pl-10 pr-4 py-3.5 bg-white/5 border rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none transition-all ' + (errs.email ? 'border-red-400' : 'border-white/10 focus:border-teal-400')} />
            </div>
            {errs.email ? <p className="text-red-400 text-xs mt-1.5 ml-1">Please enter a valid email</p> : null}
          </div>

          <div className="slide-up slide-up-delay-3">
            <label htmlFor="signup-mobile" className="block text-sm font-medium text-gray-300 mb-2">Mobile Number <span className="text-rose-400">*</span></label>
            <MobileField id="signup-mobile" value={mobile.value} onChange={(v) => { mobile.setValue(v); setErrs((x) => ({ ...x, mobile: false })); }} error={errs.mobile} placeholder="Enter mobile number" />
            {errs.mobile ? <p className="text-red-400 text-xs mt-1.5 ml-1">Please enter a valid 10-digit mobile number</p> : null}
          </div>

          <div>
            <label className="flex items-start gap-2.5 cursor-pointer group">
              <input type="checkbox" checked={terms} onChange={(e) => { setTerms(e.target.checked); setErrs((x) => ({ ...x, terms: false })); }} className="accent-teal-500 w-4 h-4 mt-0.5" />
              <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                I agree to PuneNest's <Link to="/terms" className="text-teal-400 hover:text-teal-300">Terms of Service</Link> and <Link to="/privacy" className="text-teal-400 hover:text-teal-300">Privacy Policy</Link>
              </span>
            </label>
            {errs.terms ? <p className="text-red-400 text-xs mt-1.5 ml-1">Please accept the terms to continue</p> : null}
          </div>

          {!otp.otpSent ? (
            <>
              <button type="button" onClick={sendOtp} disabled={otp.sending} className="send-otp-btn w-full py-3 rounded-xl text-teal-400 font-semibold text-sm flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> {otp.sending ? 'Sending…' : 'Send OTP'}
              </button>
              {otp.sendError ? <p className="text-red-400 text-xs text-center">{otp.sendError}</p> : null}
            </>
          ) : (
            <>
              <div className="space-y-4">
                <div className="text-center">
                  <label className="block text-sm font-medium text-gray-300 mb-1">Enter OTP</label>
                  <p className="text-xs text-gray-500 mb-4">We've sent a 6-digit code via SMS to <span className="text-teal-400 font-medium">+91 {mobile.value}</span></p>
                </div>
                <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); setCreateError(null); }} error={otp.otpError || !!createError} />
                {otp.otpError ? <p className="text-red-400 text-xs text-center">Please enter the complete 6-digit OTP</p> : null}
                {createError ? <p className="text-red-400 text-xs text-center">{createError}</p> : null}
                {otp.sendError ? <p className="text-red-400 text-xs text-center">{otp.sendError}</p> : null}
                {authIsLive ? null : <p className="text-[11px] text-gray-600 text-center">Demo mode — enter any 6 digits to continue.</p>}
                <div className="flex items-center justify-center gap-2 text-sm">
                  <span className="text-gray-500">Didn't receive it?</span>
                  <button type="button" onClick={() => otp.resend(mobile.value)} disabled={!otp.canResend} className="text-teal-400 hover:text-teal-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {otp.canResend ? 'Resend OTP' : `Resend in ${otp.seconds}s`}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={creating || done} className="btn-teal w-full py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2" style={done ? { background: 'linear-gradient(135deg,#059669,#10b981)' } : undefined}>
                {done ? <><CheckCircle2 className="w-5 h-5" /> Account created! Redirecting…</>
                  : creating ? <><Loader2 className="w-5 h-5 animate-spin" /> Creating account…</>
                  : <>Create Account <ArrowRight className="w-4 h-4" /></>}
              </button>
            </>
          )}
        </form>

        <p className="text-center text-sm text-gray-500 mt-7">
          Already have an account?
          <Link to="/signin" className="text-teal-400 hover:text-teal-300 font-semibold transition-colors ml-1">Sign In</Link>
        </p>
      </div>
    </AuthShell>
  );
}
