/**
 * Wire ↔ seam translation for the identity-verification (Aadhaar "Verified" badge) domain.
 *
 * The badge is a trust signal, never a gate (ADR-019: "a badge, never a wall"). Nothing in the app
 * is withheld for the want of it — the only place identity has teeth is server-side, in the contact
 * gate, when an owner opts into "verified contacts only". So every translation here errs toward the
 * unverified floor: an absent, malformed or unreachable answer reads as `none`, never as a badge.
 *
 * Two shapes cross the wire, and each needs its own translation because the server and the UI
 * disagree about something real:
 *
 * ## 1. The badge: a boolean the UI draws, a status the flow branches on
 *
 * `GET /me/verification/aadhaar` answers 200 with a document even for someone who never tried —
 * `{ badge:false, status:"none", … }` — rather than 404, so `res` is always an object and every
 * field on it may be null. `verified` is `badge` (the server's word for "granted"); `status` carries
 * the finer state (`none|pending|verified|failed`) the modal and the nudges branch on.
 *
 * `aadhaarMobile` is on the mock's view model but never on the wire — DigiLocker returns no mobile,
 * only the masked last four. It is carried here as `''` so the two providers answer the same keys;
 * the one reader that wants it (the tenant-profile mirror) already falls back to the account mobile
 * when it is blank.
 *
 * ## 2. The start handle: a 202 with a hosted url, not a badge
 *
 * `POST /me/verification/aadhaar` does NOT grant the badge. It answers 202 with a DigiLocker consent
 * url; the badge is granted only when the signed webhook lands, which nothing the browser does can
 * make happen. So a start is a *pending handle* the modal redirects on — treating "the POST
 * returned" as "verified" would light a trust badge for an abandoned consent screen.
 */

/** The never-attempted / signed-out badge — the floor the domain degrades to, never an error. */
export const NONE_VERIFICATION = Object.freeze({
  verified: false,
  status: 'none',
  source: null,
  maskedAadhaar: null,
  mobileMatch: null,
  verifiedAt: null,
  aadhaarMobile: '',
});

/** Wire `AadhaarVerificationResponse` → the seam's badge view model. */
export function toVerificationViewModel(res) {
  if (!res || typeof res !== 'object') return { ...NONE_VERIFICATION };
  return {
    verified: !!res.badge,
    status: res.status || 'none',
    source: res.source ?? null,
    maskedAadhaar: res.maskedAadhaar ?? null,
    // Soft signal only at MVP (ADR-009a): whether the DigiLocker mobile matched the account one.
    mobileMatch: res.mobileMatch ?? null,
    verifiedAt: res.verifiedAt ? Date.parse(res.verifiedAt) || null : null,
    // Never on the wire (see header). Present so the shape matches the mock provider.
    aadhaarMobile: '',
  };
}

/** Wire `KycStartResponse` (202) → the in-flight handle the modal redirects the browser to. */
export function toStartHandle(res) {
  return {
    pending: true,
    verified: false,
    ref: res?.ref ?? null,
    verificationUrl: res?.verificationUrl ?? null,
    expiresAt: res?.expiresAt ? Date.parse(res.expiresAt) || null : null,
    perk: null,
  };
}
