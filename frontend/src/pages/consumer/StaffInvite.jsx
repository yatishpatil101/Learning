import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CheckCircle2, KeyRound, Loader2, Lock, Ticket } from 'lucide-react';
import { redeemStaffInvite } from '../../services/authService.js';
import StaffShell, { StaffField, STAFF_SUBMIT } from '../../components/auth/StaffShell.jsx';

/* A new colleague turns their invite into a password. The token may arrive in the URL fragment,
   which never reaches a server log, or be pasted from the message it came in. */
export default function StaffInvite() {
  const [token, setToken] = useState(() => window.location.hash.slice(1));
  // Keep the single-use token out of history and session restore.
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, []);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!token.trim()) return setError('Paste the invite code you were sent.');
    if (password.length < 12 || new TextEncoder().encode(password).length > 72) return setError('Use 12 to 72 characters.');
    if (password !== repeat) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await redeemStaffInvite({ token: token.trim(), password });
      setDone(true);
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <StaffShell icon={CheckCircle2} title="Password set" subtitle="Sign in next — you'll set up your authenticator app.">
        <Link to="/staff-login" className={STAFF_SUBMIT}>Go to sign-in <ArrowRight className="w-4 h-4" /></Link>
      </StaffShell>
    );
  }

  return (
    <StaffShell icon={KeyRound} title="Set your password" subtitle="Choose a password for your Draazy staff account.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <StaffField id="invite-token" label="Invite code" icon={Ticket} autoComplete="off" autoCapitalize="off" placeholder="Paste the code you were sent" value={token} onChange={(e) => setToken(e.target.value)} />
        <StaffField id="invite-password" label="New password · 12+ characters" icon={Lock} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <StaffField id="invite-repeat" label="Repeat password" icon={Lock} type="password" autoComplete="new-password" enterKeyHint="done" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        {error && <p id="staff-invite-error" role="alert" className="text-red-400 text-xs text-center">{error}</p>}
        <button type="submit" disabled={busy} className={STAFF_SUBMIT}>
          {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : <>Set password <ArrowRight className="w-4 h-4" /></>}
        </button>
      </form>
    </StaffShell>
  );
}
