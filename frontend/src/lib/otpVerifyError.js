/**
 * Turn a failed OTP verification into a translatable message key, classified on the machine `code`
 * and never the status — the statuses collide in both directions (docs/flows/consumer/auth.md).
 */

/** Terminal refusal messages and whether a fresh code is a meaningful remedy. */
const TERMINAL = {
  account_archived: { messageKey: 'auth.errAccountArchived', resendable: false },
  signups_closed: { messageKey: 'auth.errSignupsClosed', resendable: false },
  otp_attempts_exhausted: { messageKey: 'auth.errOtpExhausted', resendable: true },
};

/**
 * `terminal` means the code in hand is spent or the account cannot sign in at all, so the submit
 * control should be blocked; `resendable` says whether a fresh code is a meaningful remedy.
 */
export function classifyOtpVerifyError(err) {
  // `hasOwn` rather than a bare index: `err.code` is server-controlled, and `TERMINAL.constructor`
  // is truthy on any plain object, which would hand the caller a function as a message key.
  if (Object.hasOwn(TERMINAL, err?.code)) {
    return { ...TERMINAL[err.code], terminal: true };
  }

  const left = err?.attemptsRemaining;
  if (typeof left === 'number') {
    // Zero is the last allowed guess reporting back, not a refusal — the server has burnt the code
    // and the next submit could only ever 429, so stop here rather than offering it.
    return left > 0
      ? { messageKey: 'auth.errOtpAttemptsLeft', count: left, terminal: false }
      : { messageKey: 'auth.errOtpExhausted', terminal: true, resendable: true };
  }

  // A 401 with no count is a code the server does not hold: expired (5-minute TTL) or already
  // spent. Retrying loops the user against a code that can never succeed, so it is terminal too.
  if (err?.status === 401) return { messageKey: 'auth.errOtpGone', terminal: true, resendable: true };
  if (err?.status === 429) return { messageKey: 'auth.errOtpBusy', terminal: false };
  if (err?.status === 403) return { messageKey: 'auth.errSignInBlocked', terminal: true, resendable: false };
  // No status at all means the request was never answered — the guess is untouched, so retry.
  return { messageKey: err?.status ? 'common.somethingWentWrong' : 'connectivity.listUnreachable',
    terminal: false };
}
