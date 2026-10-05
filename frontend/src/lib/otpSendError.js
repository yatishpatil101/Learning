/* Send errors are all retryable, so this stays separate from terminal verify failures. */
import { PROVIDER_LOAD_FAILED, isDefinitelyOffline } from './seamErrors.js';

export function classifyOtpSendError(err) {
  /* Provider-load failures mean either a stale shell or offline device; split them client-side. */
  if (err?.code === PROVIDER_LOAD_FAILED) {
    return isDefinitelyOffline() ? 'connectivity.listUnreachable' : 'common.appStale';
  }
  if (err?.code === 'signups_closed') return 'auth.errSignupsClosed';
  if (err?.code === 'account_archived') return 'auth.errAccountArchived';
  if (err?.code === 'owner_consent_self') return 'auth.errOwnerConsentSelf';
  if (err?.status === 429) return 'auth.errOtpBusy';
  if (err?.status === 403) return 'auth.errSignInBlocked';
  /* Status-less failures are shown as connectivity; retry wording is safer than exposing internals. */
  if (!err?.status) return 'connectivity.listUnreachable';
  return 'common.somethingWentWrong';
}
