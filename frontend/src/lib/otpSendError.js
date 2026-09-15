/**
 * Kept apart from `otpVerifyError.js` because dispatch spends no code: there is no
 * terminal/resendable distinction to draw here, and every outcome is retryable.
 */
import { PROVIDER_LOAD_FAILED, isDefinitelyOffline } from './seamErrors.js';

export function classifyOtpSendError(err) {
  /* The app's own code could not be fetched, so the server never saw this. A redeploy is the
     common cause — this tab holds a service-worker-cached shell naming chunks the origin has
     replaced — and the only remedy is a reload. But an offline phone fails the identical way, and
     telling someone with no signal to reload is advice that cannot work, so ask the OS first. */
  if (err?.code === PROVIDER_LOAD_FAILED) {
    return isDefinitelyOffline() ? 'connectivity.listUnreachable' : 'common.appStale';
  }
  if (err?.code === 'signups_closed') return 'auth.errSignupsClosed';
  if (err?.code === 'account_archived') return 'auth.errAccountArchived';
  if (err?.status === 429) return 'auth.errOtpBusy';
  if (err?.status === 403) return 'auth.errSignInBlocked';
  /* No status at all means the request was never answered — offline, DNS, connection refused. A
     bug in the dispatch itself (a `TypeError`) also lands here and is misattributed to the
     network; accepted, because the alternative is telling a user to retry something that a
     correctly-working network has already delivered. */
  if (!err?.status) return 'connectivity.listUnreachable';
  return 'common.somethingWentWrong';
}
