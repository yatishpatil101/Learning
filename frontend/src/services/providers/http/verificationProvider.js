/**
 * HTTP verification provider for `GET`/`POST /me/verification/identity`.
 * The badge is display-only here (ADR-019); the contact gate that reads identity lives server-side.
 */
import { get, post, postMultipart } from '../../http.js';
import { readAccessToken } from '../../../lib/auth.js';
import {
  NONE_VERIFICATION,
  toSubmissionPayload,
  toSubmissionResult,
  toVerificationViewModel,
} from './verificationMapper.js';

/**
 * The caller's badge. Signed-out is answered locally with the none-tier: the endpoint is
 * caller-scoped, so an anonymous browser could only get a 401 out of a wasted round trip.
 */
export async function getAadhaarStatus() {
  if (!readAccessToken()) return { ...NONE_VERIFICATION };
  const res = await get('/me/verification/identity');
  return toVerificationViewModel(res);
}

export async function submitIdentityVerification(input) {
  const res = await postMultipart('/me/verification/identity', toSubmissionPayload(input));
  return toSubmissionResult(res);
}

export async function simulateIdentityVerification(outcome = 'approve') {
  const res = await post('/me/verification/identity/simulate', null, { query: { outcome } });
  return toSubmissionResult(res);
}
