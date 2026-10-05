import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { KeyRound } from 'lucide-react';
import { redeemStaffInvite } from '../../services/authService.js';
import StaffShell, { STAFF_FIELD } from '../../components/auth/StaffShell.jsx';

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
      <StaffShell title="Password set" subtitle="Sign in next — you'll set up your authenticator app.">
        <Link to="/staff-login" className="dz-control dz-control--action w-full justify-center">Go to sign-in</Link>
      </StaffShell>
    );
  }

  return (
    <StaffShell title="Set your password" subtitle="Choose a password for your Draazy staff account.">
      <form onSubmit={submit} noValidate>
        <label htmlFor="invite-token" className="mb-2 block text-xs font-semibold text-gray-300">Invite code</label>
        <input id="invite-token" autoComplete="off" autoCapitalize="off" value={token} onChange={(e) => setToken(e.target.value)} className={STAFF_FIELD + ' mb-4'} />
        <label htmlFor="invite-password" className="mb-2 block text-xs font-semibold text-gray-300">New password · 12+ characters</label>
        <input id="invite-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={STAFF_FIELD + ' mb-4'} />
        <label htmlFor="invite-repeat" className="mb-2 block text-xs font-semibold text-gray-300">Repeat password</label>
        <input id="invite-repeat" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={STAFF_FIELD + ' mb-4'} />
        {error && <p id="staff-invite-error" role="alert" className="mb-3 text-center text-xs text-red-400">{error}</p>}
        <button type="submit" disabled={busy} className="dz-control dz-control--action w-full justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
          <KeyRound className="h-4 w-4" /> {busy ? 'Saving…' : 'Set password'}
        </button>
      </form>
    </StaffShell>
  );
}
