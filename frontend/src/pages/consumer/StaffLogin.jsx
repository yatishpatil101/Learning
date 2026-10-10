import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import QRCode from 'qrcode';
import { ArrowRight, Building2, Copy, KeyRound, Loader2, Lock, Mail, QrCode, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { staffEnrol, staffLogin } from '../../services/authService.js';
import { safeInAppPath } from '../../lib/authIntent.js';
import { healStaleShell } from '../../lib/seamErrors.js';
import StaffShell, { StaffField, STAFF_SUBMIT } from '../../components/auth/StaffShell.jsx';
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
    QRCode.toDataURL(enrolment.otpauthUri, { margin: 2, width: 200 }).then(
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
    <p id="staff-login-error" role="alert" className="text-red-400 text-xs text-center">{error}</p>
  );
  const checking = <><Loader2 className="w-5 h-5 animate-spin" /> Checking…</>;

  if (step === 'codes') {
    return (
      <StaffShell icon={KeyRound} title="Save your recovery codes" subtitle="Each works once if you lose your phone. They won't be shown again.">
        <div className="space-y-5">
          <ul id="staff-recovery-codes" tabIndex={-1} aria-label="Recovery codes" className="grid grid-cols-2 gap-2 font-mono text-sm text-teal-100 outline-none">
            {recovery.codes.map((c) => <li key={c} className="rounded-lg bg-white/[.05] px-2 py-2 text-center tracking-wider">{c}</li>)}
          </ul>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(recovery.codes.join('\n')).then(() => setCopied('Copied'), () => setCopied('Copy failed — write them down'))}
            className="send-otp-btn w-full py-3 rounded-xl text-teal-400 font-semibold text-sm flex items-center justify-center gap-2"
          >
            <Copy className="w-4 h-4" /> <span aria-live="polite">{copied || 'Copy codes'}</span>
          </button>
          <button type="button" onClick={() => navigate(safeNext(recovery.user), { replace: true })} className={STAFF_SUBMIT}>
            I've saved them — continue <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </StaffShell>
    );
  }

  if (step === 'password') {
    return (
      <StaffShell icon={Building2} title="Sign in to your workspace" subtitle="Use your work email and password.">
        <form key="password" onSubmit={submitPassword} className="space-y-5" noValidate>
          <StaffField id="staff-email" label="Work email" icon={Mail} type="email" autoComplete="username" autoFocus enterKeyHint="next" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <StaffField id="staff-password" label="Password" icon={Lock} type="password" autoComplete="current-password" enterKeyHint="go" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {errorLine}
          <button type="submit" disabled={busy} className={STAFF_SUBMIT}>
            {busy ? checking : <>Continue <ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>
      </StaffShell>
    );
  }

  const enrolling = step === 'enrol';
  return (
    <StaffShell
      icon={enrolling ? QrCode : ShieldCheck}
      title={enrolling ? 'Set up your authenticator' : 'Enter your code'}
      subtitle={enrolling ? 'Scan with Google Authenticator, Microsoft Authenticator or similar.' : 'From your authenticator app, or a recovery code.'}
    >
      <form key="code" onSubmit={submitCode} className="space-y-5" noValidate>
        {enrolling && (
          <div className="flex flex-col items-center gap-3">
            {qr && <img src={qr} alt="Authenticator QR code" width="176" height="176" className="rounded-2xl shadow-lg shadow-teal-500/20" />}
            <p className="text-xs text-gray-500">Can't scan? Enter this key in the app</p>
            <code id="staff-totp-secret" className="max-w-full break-all rounded-lg bg-white/[.05] px-3 py-2 text-center font-mono text-xs tracking-wider text-teal-100 select-all">{enrolment?.secret}</code>
          </div>
        )}
        <StaffField
          id="staff-code"
          label={enrolling ? '6-digit code from the app' : 'Code'}
          autoComplete="one-time-code"
          autoFocus={!enrolling}
          inputMode={enrolling ? 'numeric' : 'text'}
          autoCapitalize="off"
          enterKeyHint="done"
          maxLength={32}
          placeholder={enrolling ? '000000' : '000000 or recovery code'}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="text-center font-mono text-lg tracking-[0.3em] placeholder:tracking-normal placeholder:text-sm placeholder:font-sans"
        />
        {errorLine}
        <button type="submit" disabled={busy} className={STAFF_SUBMIT}>
          {busy ? checking : <>{enrolling ? 'Confirm & sign in' : 'Sign in'} <ArrowRight className="w-4 h-4" /></>}
        </button>
      </form>
    </StaffShell>
  );
}
