import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Home, Shield, Users, Send, LogIn } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { getTeamMemberByMobile } from '../../lib/mockApi.js';
import { isHttpDomain } from '../../services/config.js';
import { sendOtp as sendOtpSvc } from '../../services/authService.js';
import { useMobileInput } from '../../lib/hooks.js';
import { useOtpFlow } from '../../components/auth/useOtpFlow.js';
import OtpBoxes from '../../components/auth/OtpBoxes.jsx';
import Select from '../../components/ui/Select.jsx';
import MobileField from '../../components/MobileField.jsx';

const TEAMS = [
  { value: 'rental', label: 'Rent Agreement' },
  { value: 'legal', label: 'Property & Legal' },
  { value: 'loans', label: 'Home Loans' },
  { value: 'interior', label: 'Interior & Renovation' },
  { value: 'packers', label: 'Packers & Movers' },
  { value: 'valuation', label: 'Property Valuation' },
];

const TEAM_LABEL = {
  rental: 'Rent Agreement',
  legal: 'Property & Legal',
  loans: 'Home Loans',
  interior: 'Interior & Renovation',
  packers: 'Packers & Movers',
  valuation: 'Property Valuation',
};

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
  const { staffLogin, login, logout } = useAuth();
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
   * The important consequence is that **the role and team stop being a choice made in the browser**.
   * On mocks the radio buttons below decide who you are; that is a demo affordance and always was.
   * Live, the server returns the authenticated account's own role and team and this screen obeys
   * them — it cannot do otherwise, because the token it now holds was minted for that account and
   * every API call behind the console is authorised server-side regardless of what this page
   * believes. Keeping the picker authoritative would only mean showing an operator a console their
   * token cannot load.
   */
  const authIsLive = isHttpDomain('auth');
  const [role, setRole] = useState('admin');
  const [team, setTeam] = useState('rental');
  const mobile = useMobileInput('');
  const [mobileErr, setMobileErr] = useState(false);
  const [signInError, setSignInError] = useState(null);
  const [verifying, setVerifying] = useState(false);
  // Live, this dispatches a real SMS code; on mocks the hook's own simulated delay stands in.
  const otp = useOtpFlow(authIsLive ? (m) => sendOtpSvc({ mobile: m }) : undefined);

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
    // The hook takes the mobile as an argument; omitting it worked only because the mock dispatch
    // ignores what it is given, and would have sent the live provider a click event.
    otp.send(mobile.value);
  };

  /** The roles the internal console exists for. Anything else is a consumer at the wrong door. */
  const INTERNAL = new Set(['admin', 'staff']);

  const verify = async () => {
    if (otp.otp.length !== 6) {
      otp.setOtpError(true);
      return;
    }

    if (authIsLive) {
      setVerifying(true);
      setSignInError(null);
      try {
        // The server verifies the code and answers with the account — including the role and team
        // it really holds. Nothing from the radio buttons is sent, so nothing from them can be
        // trusted back.
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
      return;
    }

    // Mock path, unchanged: a registered internal account (matched by mobile) carries its own role
    // and scoped module access — that always wins over the radio selection — and an unknown number
    // becomes whatever the radios say. Both are demo affordances; neither survives `authIsLive`.
    const rec = getTeamMemberByMobile(mobile.value);
    let who;
    if (rec) {
      who = { name: rec.name, role: rec.role, roleId: rec.roleId, moduleAccess: rec.moduleAccess, team: rec.teams?.[0] || null, teams: rec.teams || [], mobile: mobile.value };
    } else {
      const teamVal = role === 'staff' ? team : null;
      const label = role === 'admin' ? 'Administrator' : (TEAM_LABEL[teamVal] || 'Team member') + ' team';
      who = { name: label, role, team: teamVal, teams: teamVal ? [teamVal] : [], mobile: mobile.value };
    }
    await staffLogin(who);
    navigate(safeNext(who.role, homeFor(who)), { replace: true });
  };

  // Demo quick-access for a seeded scoped internal account (skips OTP).
  const quickTeam = async (m) => {
    const rec = getTeamMemberByMobile(m);
    if (!rec) return;
    const who = { name: rec.name, role: rec.role, roleId: rec.roleId, moduleAccess: rec.moduleAccess, team: rec.teams?.[0] || null, teams: rec.teams || [], mobile: rec.mobile };
    await staffLogin(who);
    navigate(safeNext(who.role, homeFor(who)), { replace: true });
  };

  const quickLogin = async (qRole, qTeam) => {
    if (qRole === 'admin') {
      await staffLogin({ name: 'Administrator', role: 'admin', team: null, teams: [], mobile: '9000000000' });
      navigate(safeNext('admin', '/admin'), { replace: true });
    } else {
      const who = {
        name: (TEAM_LABEL[qTeam] || 'Team member') + ' team',
        role: 'staff',
        team: qTeam,
        teams: [qTeam],
        mobile: '9000000000',
      };
      await staffLogin(who);
      navigate(safeNext('staff', homeFor(who)), { replace: true });
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
            <div className="text-xl font-extrabold">PuneNest</div>
            <div className="-mt-0.5 text-[11px] text-gray-400">Internal Console</div>
          </div>
        </div>

        <div className="pn-card rounded-2xl p-7">
          <h1 className="mb-1 text-lg font-bold">Sign in to your workspace</h1>
          <p className="mb-5 text-sm text-gray-400">Admin & service-team access only.</p>

          {/* On mocks these radios decide who you are. Live they would decide nothing — the server
              returns the account's own role — so they are not rendered rather than rendered inert:
              a control that visibly does nothing is a worse lie than no control. */}
          {!authIsLive && (
            <>
          <label className="mb-2 block text-xs font-semibold text-gray-300" id="staff-role-label">I am signing in as</label>
          <div className="mb-4 grid grid-cols-2 gap-2.5" role="radiogroup" aria-labelledby="staff-role-label">
            <div
              role="radio"
              aria-checked={role === 'admin'}
              tabIndex={0}
              className={
                'pn-card flex cursor-pointer items-center gap-2.5 rounded-xl p-3 transition ' +
                (role === 'admin' ? 'border-teal-500 bg-teal-500/10 shadow-[0_0_0_3px_rgba(20,184,166,0.12)]' : 'hover:border-teal-500/40 hover:bg-teal-500/5')
              }
              onClick={() => setRole('admin')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRole('admin'); } }}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/20">
                <Shield className="h-4.5 w-4.5 text-indigo-300" />
              </div>
              <div>
                <div className="text-sm font-semibold">Administrator</div>
                <div className="text-[10px] text-gray-400">Full control</div>
              </div>
            </div>
            <div
              role="radio"
              aria-checked={role === 'staff'}
              tabIndex={0}
              className={
                'pn-card flex cursor-pointer items-center gap-2.5 rounded-xl p-3 transition ' +
                (role === 'staff' ? 'border-teal-500 bg-teal-500/10 shadow-[0_0_0_3px_rgba(20,184,166,0.12)]' : 'hover:border-teal-500/40 hover:bg-teal-500/5')
              }
              onClick={() => setRole('staff')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRole('staff'); } }}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500/20">
                <Users className="h-4.5 w-4.5 text-teal-300" />
              </div>
              <div>
                <div className="text-sm font-semibold">Service team</div>
                <div className="text-[10px] text-gray-400">Ops portal</div>
              </div>
            </div>
          </div>

          {role === 'staff' && (
            <div className="mb-4">
              <label className="mb-2 block text-xs font-semibold text-gray-300">Your team</label>
              <Select value={team} onChange={setTeam} options={TEAMS} />
            </div>
          )}
            </>
          )}

          {authIsLive && (
            <p className="mb-4 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-[12px] leading-relaxed text-gray-400">
              Sign in with the mobile number on your internal account. Your console and team come
              from that account — there is nothing to choose here.
            </p>
          )}

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
                className="pn-control pn-control--action w-full justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="h-4 w-4" /> {otp.sending ? 'Sending…' : 'Send OTP'}
              </button>
              {otp.sendError && <p className="mt-2 text-center text-xs text-red-400">{otp.sendError}</p>}
            </>
          ) : (
            <div className="mt-4">
              <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-center text-[12px] text-emerald-200">
                OTP sent via SMS to <span className="font-semibold">+91 {mobile.value}</span>
                {!authIsLive && (
                  <>
                    <br />
                    <span className="text-emerald-300/90">
                      Demo OTP: <b className="tracking-widest">123456</b>
                    </span>
                  </>
                )}
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
                className="pn-control pn-control--action w-full justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LogIn className="h-4 w-4" /> {verifying ? 'Signing in…' : 'Verify & sign in'}
              </button>
            </div>
          )}

          {/* Demo shortcuts. They mint a session from a hardcoded mobile with no code exchanged,
              which is exactly the thing a real sign-in exists to prevent — so they cannot survive
              into the live path. They are kept for the mock build because the prototype has no
              seeded internal accounts to sign in as. */}
          {!authIsLive && (
          <div className="mt-5 border-t border-white/8 pt-4">
            <p className="mb-2.5 text-center text-[11px] text-gray-500">Demo quick access — skips OTP</p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                ['Admin', () => quickLogin('admin')],
                ['Rental', () => quickLogin('staff', 'rental')],
                ['Legal', () => quickLogin('staff', 'legal')],
                ['Loans', () => quickLogin('staff', 'loans')],
                ['Interior', () => quickLogin('staff', 'interior')],
                ['Packers', () => quickLogin('staff', 'packers')],
                ['Valuation', () => quickLogin('staff', 'valuation')],
              ].map(([label, action]) => (
                <button
                  key={label}
                  type="button"
                  onClick={action}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-white/10 hover:text-white hover:border-teal-400/40"
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mb-2.5 mt-4 text-center text-[11px] text-gray-500">Scoped managers — limited admin tabs</p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                ['Verifications', '9800000001'],
                ['Requests Desk', '9800000002'],
                ['Content', '9800000003'],
              ].map(([label, m]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => quickTeam(m)}
                  className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20 hover:text-white hover:border-indigo-400/40"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          )}
        </div>
        <p className="mt-5 text-center text-[11px] text-gray-600">
          {authIsLive ? 'Internal access only · every action is logged. ' : 'Prototype · mock authentication, not real security. '}
          <Link to="/" className="text-teal-400 hover:underline">Back to site</Link>
        </p>
      </div>
    </div>
  );
}
