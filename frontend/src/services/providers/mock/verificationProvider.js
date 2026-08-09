/**
 * Mock verification provider — the localStorage counterpart to providers/http/verificationProvider.js.
 *
 * The badge lives in the per-user Aadhaar record (`getAadhaarVerification`). Unlike the wire, the
 * mock has no DigiLocker consent page to visit and no webhook to wait for, so `startAadhaar` stands
 * in for the whole round-trip and grants the badge at once — a localStorage write cannot fail, and
 * this is the demo's instant-verify path.
 *
 * Moving that write behind the seam is the point of this slice: the modal can no longer be written
 * against "click, and you are verified" (true only here) and then silently break in http mode, where
 * a start returns a pending handle and the badge waits on a webhook. Both providers now answer the
 * same two operations; the service and the modal branch on `verified` vs `pending` in the result.
 */
import { getAadhaarVerification, setAadhaarVerified } from '../../../lib/store.js';
import { applyVerifiedBadgeToListings } from '../../../lib/mockApi.js';
import { NONE_VERIFICATION } from '../http/verificationMapper.js';

/** How long the mock lingers on the "opening DigiLocker" step, standing in for the real redirect
    round-trip so the earn flow feels the same as production rather than snapping to verified. */
const MOCK_REDIRECT_MS = 1700;

/** The caller's badge, read from the local Aadhaar record. Same view-model shape as the http side. */
export async function getAadhaarStatus() {
  const rec = getAadhaarVerification();
  if (!rec || !rec.verified) return { ...NONE_VERIFICATION };
  // Built by overriding the shared floor shape rather than restating its keys, so a new field on
  // NONE_VERIFICATION cannot silently drop out of the verified path (which the parity harness, run
  // against an empty store, never exercises).
  return {
    ...NONE_VERIFICATION,
    verified: true,
    status: 'verified',
    source: rec.source ?? 'digilocker',
    maskedAadhaar: rec.maskedAadhaar || null,
    mobileMatch: rec.mobileMatch ?? null,
    verifiedAt: rec.at ?? null,
    aadhaarMobile: rec.aadhaarMobile || '',
  };
}

/**
 * Start verification. Simulates the DigiLocker redirect → consent → success round-trip, records the
 * badge and lights up the one-time growth perk (a free Featured slot, ADR-019). Returns the granted
 * badge plus the perk so the modal resumes the pending action; the http provider returns a pending
 * handle instead, and both the service and the modal tell them apart on `verified`.
 */
export async function startAadhaar(details = {}) {
  await new Promise((resolve) => setTimeout(resolve, MOCK_REDIRECT_MS));
  setAadhaarVerified({
    aadhaarMobile: details.aadhaarMobile || '',
    maskedAadhaar: details.maskedAadhaar || 'XXXX XXXX 1234',
    mobileMatch: details.mobileMatch ?? true, // soft signal only at MVP (ADR-009a)
    source: details.source || 'digilocker',
  });
  const perk = applyVerifiedBadgeToListings(details.aadhaarMobile || '');
  return { pending: false, verified: true, perk: perk || null };
}
