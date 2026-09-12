import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Home, Send, LogIn } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { sendOtp as sendOtpSvc } from '../../services/authService.js';
import { useMobileInput } from '../../lib/hooks.js';
import { useOtpFlow } from '../../components/auth/useOtpFlow.js';
import OtpBoxes from '../../components/auth/OtpBoxes.jsx';
import MobileField from '../../components/MobileField.jsx';
import { safeInAppPath } from '../../lib/authIntent.js';
import { classifyOtpVerifyError } from '../../lib/otpVerifyError.js';

// Where a team lands after signing in. Every service-request team lands on the one drafting desk
// with its own type pre-selected; loans has no request type, so it gets the tickets queue.
const TEAM_HOME = {
  rental: '/ops/drafting-desk?type=rental',
  legal: '/ops/drafting-desk?type=legal',
  loans: '/ops/requests',
  interior: '/ops/drafting-desk?type=interior',
  packers: '/ops/drafting-desk?type=packers',
  valuation: '/ops/drafting-desk?type=valuation',
};

export default function StaffLogin() {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  /* Staff sign in through the ordinary mobile-OTP route, and the server — not this page — decides
     their role and team. See `docs/flows/consumer/auth.md` § Staff login. */
  const mobile = useMobileInput('');
  const [mobileErr, setMobileErr] = useState(false);
  const [signInError, setSignInError] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [otpSpent, setOtpSpent] = useState(false);
  const [otpCanBeRenewed, setOtpCanBeRenewed] = useState(true);
  const otp = useOtpFlow((m) => sendOtpSvc({ mobile: m }));

  /* Only administrators open the admin console; an ops staffer's permission atoms widen what the
     API grants them inside the service portal rather than promoting them to another shell. */
  const homeFor = (who) => {
    if (who.role === 'admin') return '/admin';
    const t = (who.teams && who.teams[0]) || who.team;
    return TEAM_HOME[t] || '/ops';
  };

  /* Two separate questions, both load-bearing: `safeInAppPath` (shared, so the doors cannot drift)
     answers "is it a usable path", and the role checks answer "may this account go there". */
  const safeNext = (forRole, def) => {
    const n = safeInAppPath(params.get('next'));
    if (!n) return def;
    const lower = n.toLowerCase();
    if (lower.startsWith('/admin') && forRole !== 'admin') return def;
    if (lower.startsWith('/ops') && forRole !== 'staff' && forRole !== 'admin') return def;
    return n;
  };

  const sendOtp = () => {
    if (!mobile.valid) {
      setMobileErr(true);
      return;
    }
    setMobileErr(false);
    setSignInError(null);
    otp.send(mobile.value);
  };

  /** The roles the internal console exists for. Anything else is a consumer at the wrong door. */
  const INTERNAL = new Set(['admin', 'staff']);

  const verify = async () => {
    if (otpSpent) return;
    if (otp.otp.length !== 6) {
      otp.setOtpError(true);
      return;
    }

    setVerifying(true);
    setSignInError(null);
    try {
      // The server verifies the code and answers with the account — including the role and team
      // it really holds.
      const who = await login({ mobile: mobile.value, otp: otp.otp, remember: true });

      if (!INTERNAL.has(who?.role)) {
        // Ending the session is deliberate: the code was valid, so leaving it open would sign a
        // buyer in through the staff entrance and merely decline to redirect them.
        await logout();
        setSignInError(
          'That number is not an internal account. Staff and administrators are added by an '
            + 'existing admin — sign in at the main site instead.',
        );
        return;
      }

      navigate(safeNext(who.role, homeFor(who)), { replace: true });
    } catch (err) {
      /* The server's own sentence is kept — this console is internal and English-only — and so is
         the count, since the same per-code guess budget is spent here. */
      const left = err?.attemptsRemaining;
      const message = err?.message || 'That code did not work. Please try again.';
      const outcome = classifyOtpVerifyError(err);
      setOtpSpent(outcome.terminal);
      setOtpCanBeRenewed(!outcome.terminal || outcome.resendable === true);
      if (typeof left !== 'number') {
        setSignInError(message);
      } else if (left > 0) {
        setSignInError(`${message} — ${left} ${left === 1 ? 'try' : 'tries'} left before this code is blocked.`);
      } else {
        // Zero is the last allowed guess reporting back: the code is spent, so the next submit can
        // only be refused. Saying "try again" here would be an instruction that cannot work.
        setSignInError(`${message} — that was the last try. Request a new code.`);
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-5">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366f1] to-[#14b8a6]">
            <Home className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="text-xl font-extrabold">Draazy</div>
            <div className="-mt-0.5 text-[11px] text-gray-400">Internal Console</div>
          </div>
        </div>

        <div className="dz-card rounded-2xl p-7">
          <h1 className="mb-1 text-lg font-bold">Sign in to your workspace</h1>
          <p className="mb-5 text-sm text-gray-400">Admin & service-team access only.</p>

          {/* No role or team picker: the server returns the account's own, and a control that
              visibly does nothing is a worse lie than no control. */}
          <p className="mb-4 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-[12px] leading-relaxed text-gray-400">
            Sign in with the mobile number on your internal account. Your console and team come
            from that account — there is nothing to choose here.
          </p>

          <div className="mb-4">
            <label htmlFor="staff-mobile" className="mb-2 block text-xs font-semibold text-gray-300">
              Mobile number <span className="text-rose-400">*</span>
            </label>
            <MobileField id="staff-mobile" value={mobile.value} onChange={(v) => { if (v !== mobile.value && otp.otpSent) { otp.reset(); setSignInError(null); setOtpSpent(false); setOtpCanBeRenewed(true); } mobile.setValue(v); setMobileErr(false); }} error={mobileErr} disabled={otp.sending || verifying} placeholder="Enter mobile number" />
            {mobileErr && <p className="mt-1.5 text-xs text-red-400">Enter a valid 10-digit mobile number.</p>}
          </div>

          <p id="staff-otp-status" role="alert" className={otp.otpError || otp.sendError || signInError ? 'mb-2 text-center text-xs text-red-400' : 'sr-only'}>{otp.otpError ? 'Incorrect or incomplete OTP.' : otp.sendError || signInError}</p>

          {!otp.otpSent ? (
            <>
              <button
                type="button"
                onClick={sendOtp}
                disabled={otp.sending}
                className="dz-control dz-control--action w-full justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="h-4 w-4" /> {otp.sending ? 'Sending…' : 'Send OTP'}
              </button>
            </>
          ) : (
            <div className="mt-4">
              <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-center text-[12px] text-emerald-200">
                OTP sent via SMS to <span className="font-semibold">+91 {mobile.value}</span>
              </div>
              <p className="mb-2 text-center text-xs font-semibold text-gray-300">Enter the 6-digit OTP</p>
              <div className="mb-2">
                <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); if (!otpSpent) setSignInError(null); }} error={otp.otpError || !!signInError} />
              </div>
              <div className="mb-3 text-center text-[11px] text-gray-500">
                Didn't get it?{' '}
                <button
                  type="button"
                  onClick={async () => { if (await otp.resend(mobile.value)) { setSignInError(null); setOtpSpent(false); setOtpCanBeRenewed(true); } }}
                  disabled={!otp.canResend || otp.sending || !otpCanBeRenewed}
                  className="font-semibold text-teal-400 hover:text-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {otp.canResend ? 'Resend OTP' : `Resend in ${otp.seconds}s`}
                </button>
              </div>
              <button
                type="button"
                onClick={verify}
                disabled={verifying || otpSpent}
                className="dz-control dz-control--action w-full justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LogIn className="h-4 w-4" /> {verifying ? 'Signing in…' : 'Verify & sign in'}
              </button>
            </div>
          )}

          {/* No demo "sign in as <team>" shortcuts: minting a session from a hardcoded mobile
              with no code exchanged is the thing a real sign-in exists to prevent. */}
        </div>
        <p className="mt-5 text-center text-[11px] text-gray-600">
          Internal access only · every action is logged.{' '}
          <Link to="/" className="text-teal-400 hover:underline">Back to site</Link>
        </p>
      </div>
    </div>
  );
}
