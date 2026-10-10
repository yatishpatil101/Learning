import { PROVIDER_LOAD_FAILED, isDefinitelyOffline } from './seamErrors.js';

/* Staff screens are English-only, so these are sentences rather than i18n keys. */
const OFFLINE = "Can't reach Draazy. Check your internet connection and try again.";

const WRONG = {
  password: 'Wrong email or password. Check both and try again.',
  totp: "That code didn't work. Enter the code your authenticator app shows now, or a recovery code.",
  enrol: "That code didn't work. Make sure you scanned this QR code, then enter the code your app shows now.",
  invite: 'This invite code is invalid or has expired. Ask an admin to send you a new one.',
};

const INVALID = {
  password: 'Enter a valid work email and your password.',
  totp: 'Enter the 6-digit code from your authenticator app.',
  enrol: 'Enter the 6-digit code from your authenticator app.',
  invite: 'Paste the full invite code and use a password of 12 to 72 characters.',
};

function tooMany(seconds) {
  if (!(seconds > 0)) return 'Too many tries. Wait a minute and try again.';
  const [n, unit] = seconds < 60 ? [Math.ceil(seconds), 'second'] : [Math.ceil(seconds / 60), 'minute'];
  const wait = new Intl.NumberFormat('en', { style: 'unit', unit, unitDisplay: 'long' }).format(n);
  return `Too many tries. Wait ${wait} and try again.`;
}

/** The sentence a staff sign-in step shows for `err`. `step` is password | totp | enrol | invite. */
export function staffAuthError(err, step) {
  if (err?.code === PROVIDER_LOAD_FAILED) {
    return isDefinitelyOffline() ? OFFLINE : 'Draazy was updated. Reload the page to continue.';
  }
  if (!err?.status) return OFFLINE;
  if (err.code === 'staff_sign_in_expired') return 'Your sign-in timed out. Enter your email and password again.';
  if (err.status === 429) return tooMany(err.retryAfterSeconds);
  if (err.status === 401) return WRONG[step];
  // The server's sentences for these name the remedy; only our backend sends an `error` code with them,
  // so a proxy's 403 page never reaches the user as `err.message`.
  if (err.status === 403 || err.status === 409) {
    const fromServer = Boolean(err.code) && err.message && err.message !== err.code;
    return fromServer ? err.message : "This account can't sign in right now. Contact an admin.";
  }
  if (err.status === 400 || err.status === 422) return INVALID[step];
  return 'Something went wrong on our side. Try again in a minute.';
}
