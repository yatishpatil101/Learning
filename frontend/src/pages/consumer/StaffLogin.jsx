import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import QRCode from 'qrcode';
import { LogIn, ShieldCheck, Copy } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { staffEnrol, staffLogin } from '../../services/authService.js';
import { safeInAppPath } from '../../lib/authIntent.js';
import { healStaleShell } from '../../lib/seamErrors.js';
import StaffShell, { STAFF_FIELD } from '../../components/auth/StaffShell.jsx';
import { portalBase } from '../../lib/adminModules.js';

/* Password, then an authenticator code; a first sign-in sets the authenticator up and shows the
   recovery codes once. The server decides role and functions. docs/flows/consumer/auth.md § Staff login */
export default function StaffLogin() {
  const { staffVerify, staffConfirm } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState('');
  const [enrolment, setEnrolment] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [copied, setCopied] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  /* Two separate questions: `safeInAppPath` (shared, so the doors cannot drift) answers "is it a
     usable path", and the role checks answer "may this account go there". */
  const safeNext = (who) => {
    const n = safeInAppPath(params.get('next'));
    if (!n) return portalBase(who);
    const lower = n.toLowerCase();
    if (/^\/(admin|staff)(\/|$)/.test(lower) && !['admin', 'manager', 'staff'].includes(who.role)) return portalBase(who);
    return n;
  };

  useEffect(() => {
    setQr('');
    if (!enrolment) return undefined;
    let live = true;
    QRCode.toDataURL(enrolment.otpauthUri, { margin: 1, width: 200 }).then(
      (url) => live && setQr(url),
      () => {},
    );
    return () => { live = false; };
  }, [enrolment]);

  const run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      if (err?.code === 'staff_sign_in_expired') {
        setStep('password');
        setPassword('');
        setChallenge('');
        setEnrolment(null);
      }
      setCode('');
      setError(err?.message || 'Something went wrong. Please try again.');
      healStaleShell(err);
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your work email and password.');
      return;
    }
    run(async () => {
      const res = await staffLogin({ email: email.trim(), password });
      setChallenge(res.challenge);
      if (res.mfa === 'enrol') {
        setEnrolment(await staffEnrol({ challenge: res.challenge }));
        setStep('enrol');
      } else {
        setStep('totp');
      }
    });
  };

  const submitCode = (e) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Enter the code.');
      return;
    }
    run(async () => {
      if (step === 'enrol') {
        const { user, recoveryCodes } = await staffConfirm({ challenge, code: code.trim() });
        setRecovery({ user, codes: recoveryCodes });
        setStep('codes');
      } else {
        const who = await staffVerify({ challenge, code: code.trim() });
        navigate(safeNext(who), { replace: true });
      }
    });
  };

  const errorLine = error && (
    <p id="staff-login-error" role="alert" className="mb-3 text-center text-xs text-red-400">{error}</p>
  );

  if (step === 'codes') {
    return (
      <StaffShell title="Save your recovery codes" subtitle="Each works once if you lose your phone. They won't be shown again.">
        <ul id="staff-recovery-codes" tabIndex={-1} aria-label="Recovery codes" className="mb-4 grid grid-cols-2 gap-2 font-mono text-sm outline-none">
          {recovery.codes.map((c) => <li key={c} className="rounded-lg bg-white/5 px-2 py-1.5 text-center">{c}</li>)}
        </ul>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(recovery.codes.join('\n')).then(() => setCopied('Copied'), () => setCopied('Copy failed — write them down'))}
          className="dz-control mb-3 w-full justify-center gap-2"
        >
          <Copy className="h-4 w-4" /> <span aria-live="polite">{copied || 'Copy codes'}</span>
        </button>
        <button type="button" onClick={() => navigate(safeNext(recovery.user), { replace: true })} className="dz-control dz-control--action w-full justify-center gap-2">
          I've saved them — continue
        </button>
      </StaffShell>
    );
  }

  if (step === 'password') {
    return (
      <StaffShell title="Sign in to your workspace" subtitle="Admin & service-team access only.">
        <form onSubmit={submitPassword} noValidate>
          <label htmlFor="staff-email" className="mb-2 block text-xs font-semibold text-gray-300">Work email</label>
          <input id="staff-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={STAFF_FIELD + ' mb-4'} />
          <label htmlFor="staff-password" className="mb-2 block text-xs font-semibold text-gray-300">Password</label>
          <input id="staff-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={STAFF_FIELD + ' mb-4'} />
          {errorLine}
          <button type="submit" disabled={busy} className="dz-control dz-control--action w-full justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
            <LogIn className="h-4 w-4" /> {busy ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </StaffShell>
    );
  }

  const enrolling = step === 'enrol';
  return (
    <StaffShell
      title={enrolling ? 'Set up your authenticator' : 'Enter your code'}
      subtitle={enrolling ? 'Scan with Google Authenticator, Microsoft Authenticator or similar.' : 'From your authenticator app, or a recovery code.'}
    >
      <form onSubmit={submitCode} noValidate>
        {enrolling && (
          <div className="mb-4 flex flex-col items-center gap-2">
            {qr && <img src={qr} alt="Authenticator QR code" width="200" height="200" className="rounded-lg bg-white p-1" />}
            <code id="staff-totp-secret" className="break-all text-center text-xs text-gray-400">{enrolment?.secret}</code>
          </div>
        )}
        <label htmlFor="staff-code" className="mb-2 block text-xs font-semibold text-gray-300">
          {enrolling ? '6-digit code from the app' : 'Code'}
        </label>
        <input
          id="staff-code"
          autoComplete="one-time-code"
          inputMode={enrolling ? 'numeric' : 'text'}
          autoCapitalize="off"
          maxLength={32}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={STAFF_FIELD + ' mb-4 text-center tracking-widest'}
        />
        {errorLine}
        <button type="submit" disabled={busy} className="dz-control dz-control--action w-full justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
          <ShieldCheck className="h-4 w-4" /> {busy ? 'Checking…' : enrolling ? 'Confirm & sign in' : 'Sign in'}
        </button>
      </form>
    </StaffShell>
  );
}
