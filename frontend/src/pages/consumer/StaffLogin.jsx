import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Home, Send, LogIn } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { sendOtp as sendOtpSvc } from '../../services/authService.js';
import { useMobileInput } from '../../lib/hooks.js';
import { useOtpFlow } from '../../components/auth/useOtpFlow.js';
import OtpBoxes from '../../components/auth/OtpBoxes.jsx';
import MobileField from '../../components/MobileField.jsx';

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
  /*
   * Which half of this screen is real.
   *
   * Against the live API the console signs in through the ordinary `/auth/login` mobile-OTP route —
   * the same one consumers use — because that is the only staff sign-in the server actually offers
   * a browser. `POST /auth/staff-login` is email+password, and D206 removed the password from
   * `POST /users/staff`: a staff account has no password until its holder redeems an emailed
   * invite, so a console that demanded one could not sign in the very people it was built for.
   *
   * The important consequence is that **the role and team are not a choice made in the browser**.
   * A radio pair used to decide who you signed in as; that was a demo affordance and always was.
   * The server returns the authenticated account's own role and team and this screen obeys them —
   * it cannot do otherwise, because the token it now holds was minted for that account and every
   * API call behind the console is authorised server-side regardless of what this page believes.
   * Keeping the picker authoritative would only mean showing an operator a console their token
   * cannot load.
   */
  const mobile = useMobileInput('');
  const [mobileErr, setMobileErr] = useState(false);
  const [signInError, setSignInError] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const otp = useOtpFlow((m) => sendOtpSvc({ mobile: m }));

  /* Where an internal account lands. Only administrators open the console: `manager` is gone with
     the custom-role bundles it labelled, and an ops staffer's permission atoms widen what the API
     grants them inside the service portal rather than promoting them to a different shell. */
  const homeFor = (who) => {
    if (who.role === 'admin') return '/admin';
    const t = (who.teams && who.teams[0]) || who.team;
    return TEAM_HOME[t] || '/ops';
  };

  // Safe next: ignore ?next= if it doesn't match the role's access
  const safeNext = (forRole, def) => {
    const n = params.get('next');
    if (!n) return def;
    const lower = n.toLowerCase();
    if (lower === '/staff-login') return def;
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
        // A real consumer signing in here would otherwise land on a console every route guard
        // refuses, which reads as a broken product rather than as a closed door. Ending the
        // session is deliberate: the code was valid, so leaving it open would sign a buyer in
        // through the staff entrance and merely decline to redirect them.
        await logout();
        setSignInError(
          'That number is not an internal account. Staff and administrators are added by an '
            + 'existing admin — sign in at the main site instead.',
        );
        return;
      }

      navigate(safeNext(who.role, homeFor(who)), { replace: true });
    } catch (err) {
      setSignInError(err?.message || 'That code did not work. Please try again.');
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

          {/* An "I am signing in as" radio pair (Administrator / Service team) and a team dropdown
              stood here, and decided who you were. They could only ever decide anything against a
              browser registry that no longer exists — the server returns the account's own role —
              so they are gone rather than rendered inert: a control that visibly does nothing is a
              worse lie than no control. */}
          <p className="mb-4 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-[12px] leading-relaxed text-gray-400">
            Sign in with the mobile number on your internal account. Your console and team come
            from that account — there is nothing to choose here.
          </p>

          <div className="mb-4">
            <label htmlFor="staff-mobile" className="mb-2 block text-xs font-semibold text-gray-300">
              Mobile number <span className="text-rose-400">*</span>
            </label>
            <MobileField id="staff-mobile" value={mobile.value} onChange={(v) => { mobile.setValue(v); setMobileErr(false); }} error={mobileErr} placeholder="Enter mobile number" />
            {mobileErr && <p className="mt-1.5 text-xs text-red-400">Enter a valid 10-digit mobile number.</p>}
          </div>

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
              {otp.sendError && <p className="mt-2 text-center text-xs text-red-400">{otp.sendError}</p>}
            </>
          ) : (
            <div className="mt-4">
              <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-center text-[12px] text-emerald-200">
                OTP sent via SMS to <span className="font-semibold">+91 {mobile.value}</span>
              </div>
              <label className="mb-2 block text-center text-xs font-semibold text-gray-300">Enter the 6-digit OTP</label>
              <div className="mb-2">
                <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); }} error={otp.otpError} />
              </div>
              {otp.otpError && <p className="mb-2 text-center text-xs text-red-400">Incorrect or incomplete OTP.</p>}
              {signInError && <p className="mb-2 text-center text-xs text-red-400">{signInError}</p>}
              <div className="mb-3 text-center text-[11px] text-gray-500">
                Didn't get it?{' '}
                <button
                  type="button"
                  onClick={() => otp.resend(mobile.value)}
                  disabled={!otp.canResend}
                  className="font-semibold text-teal-400 hover:text-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {otp.canResend ? 'Resend OTP' : `Resend in ${otp.seconds}s`}
                </button>
              </div>
              <button
                type="button"
                onClick={verify}
                disabled={verifying}
                className="dz-control dz-control--action w-full justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LogIn className="h-4 w-4" /> {verifying ? 'Signing in…' : 'Verify & sign in'}
              </button>
            </div>
          )}

          {/* Two rows of demo shortcuts stood here — seven "sign in as <team>" chips and three
              scoped-manager chips — each minting a session from a hardcoded mobile with no code
              exchanged, which is exactly the thing a real sign-in exists to prevent. They existed
              because the prototype had no seeded internal accounts to sign in as; the database
              does. */}
        </div>
        <p className="mt-5 text-center text-[11px] text-gray-600">
          Internal access only · every action is logged.{' '}
          <Link to="/" className="text-teal-400 hover:underline">Back to site</Link>
        </p>
      </div>
    </div>
  );
}
