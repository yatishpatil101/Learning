import { del, get, post, postMultipart } from '../../http.js';
import { readAccessToken } from '../../../lib/auth.js';
import {
  NONE_VERIFICATION,
  toSubmissionPayload,
  toSubmissionResult,
  toVerificationViewModel,
} from './verificationMapper.js';

export async function getAadhaarStatus() {
  if (!readAccessToken()) return { ...NONE_VERIFICATION };
  const res = await get('/me/verification/identity');
  return toVerificationViewModel(res);
}

export async function getIdentityChallenge() {
  return post('/me/verification/identity/challenge');
}

export async function submitIdentityVerification(input) {
  const res = await postMultipart('/me/verification/identity', toSubmissionPayload(input));
  return toSubmissionResult(res);
}

export async function disputeIdentityVerification(input) {
  return post('/me/verification/identity/dispute', {
    note: input.note || undefined,
  });
}

export async function withdrawIdentityVerification() {
  await del('/me/verification/identity');
  return { ...NONE_VERIFICATION };
}

export async function simulateIdentityVerification(outcome = 'approve') {
  const res = await post('/me/verification/identity/simulate', null, { query: { outcome } });
  return toSubmissionResult(res);
}
