/**
 * HTTP verification provider.
 *
 *   GET  /me/verification/aadhaar   → the caller's badge (always 200, never 404)
 *   POST /me/verification/aadhaar   → start DigiLocker consent (202 + hosted url)
 *
 * The badge is display-only on the client (ADR-019); the one gate that reads identity lives in the
 * server's contact service and is untouched by anything here. See verificationMapper.js for why a
 * start returns a pending handle rather than a granted badge.
 */
import { get, post } from '../../http.js';
import { readAccessToken } from '../../../lib/auth.js';
import { NONE_VERIFICATION, toVerificationViewModel, toStartHandle } from './verificationMapper.js';

/**
 * The caller's badge. Signed-out is answered locally with the none-tier: the endpoint is
 * caller-scoped, so for an anonymous browser it could only 401, and asking is a round trip whose
 * answer is already known.
 */
export async function getAadhaarStatus() {
  if (!readAccessToken()) return { ...NONE_VERIFICATION };
  const res = await get('/me/verification/aadhaar');
  return toVerificationViewModel(res);
}

/**
 * Start (or retry) the DigiLocker consent flow. Returns a *pending handle*, not a badge: the server
 * answers 202 with a hosted consent url and the badge is granted only when the webhook lands.
 * Its `perk` field is null because verification does not grant a ranking boost.
 *
 * @throws {ApiError} 409 `aadhaar_already_registered` — the identity is linked to another account.
 */
export async function startAadhaar() {
  const res = await post('/me/verification/aadhaar', {});
  return toStartHandle(res);
}
