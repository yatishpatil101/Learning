/* Send errors are all retryable, so this stays separate from terminal verify failures. */
import { PROVIDER_LOAD_FAILED, isDefinitelyOffline } from './seamErrors.js';

/** A 429 names the wait when the server reported one, rounded up so the user never retries early. */
export function busyMessage(seconds) {
  if (!(seconds > 0)) return { messageKey: 'auth.errOtpBusy' };
  return seconds < 60
    ? { messageKey: 'auth.errOtpBusySeconds', count: Math.ceil(seconds) }
    : { messageKey: 'auth.errOtpBusyMinutes', count: Math.ceil(seconds / 60) };
}

/** `{ messageKey, count? }` — render with `t(messageKey, { count })`. */
export function classifyOtpSendError(err) {
  /* Provider-load failures mean either a stale shell or offline device; split them client-side. */
  if (err?.code === PROVIDER_LOAD_FAILED) {
    return { messageKey: isDefinitelyOffline() ? 'connectivity.listUnreachable' : 'common.appStale' };
  }
  if (err?.code === 'signups_closed') return { messageKey: 'auth.errSignupsClosed' };
  if (err?.code === 'account_archived') return { messageKey: 'auth.errAccountArchived' };
  if (err?.code === 'owner_consent_self') return { messageKey: 'auth.errOwnerConsentSelf' };
  if (err?.status === 429) return busyMessage(err.retryAfterSeconds);
  if (err?.status === 403) return { messageKey: 'auth.errSignInBlocked' };
  /* Status-less failures are shown as connectivity; retry wording is safer than exposing internals. */
  if (!err?.status) return { messageKey: 'connectivity.listUnreachable' };
  // A 5xx on send is almost always the SMS gateway, and the remedy is the same: try shortly.
  return { messageKey: err.status >= 500 ? 'auth.errOtpSendFailed' : 'common.somethingWentWrong' };
}
