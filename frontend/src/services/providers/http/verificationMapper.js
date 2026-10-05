// Verification is a trust signal, never a client-side authorization gate.

/** The never-attempted / signed-out badge — the floor the domain degrades to, never an error. */
export const NONE_VERIFICATION = Object.freeze({
  verified: false,
  status: 'none',
  docType: null,
  docLast4: null,
  maskedDocument: null,
  submittedAt: null,
  decidedAt: null,
  rejectionReason: null,
  rejectionNote: null,
  revokedAt: null,
  revocationReason: null,
  attemptsRemaining: 3,
  retryAfter: null,
  canRetry: false,
  verifiedAt: null,
  verifiedName: null,
  source: null,
  maskedAadhaar: null,
  mobileMatch: null,
  aadhaarMobile: '',
});

const parseTime = (value) => (value ? Date.parse(value) || null : null);

/** Keep temporary compatibility fields until every caller is off the Aadhaar-shaped UI. */
export function toVerificationViewModel(res) {
  if (!res || typeof res !== 'object') return { ...NONE_VERIFICATION };
  const status = res.status || 'none';
  const decidedAt = parseTime(res.decidedAt);
  const attemptsRemaining = Number.isFinite(res.attemptsRemaining) ? res.attemptsRemaining : null;
  const canRetry = typeof res.canRetry === 'boolean'
    ? res.canRetry
    : status === 'rejected' && (attemptsRemaining == null || attemptsRemaining > 0);
  return {
    verified: status === 'verified',
    status,
    docType: res.docType ?? null,
    docLast4: res.docLast4 ?? null,
    maskedDocument: res.docLast4 ?? null,
    submittedAt: parseTime(res.submittedAt),
    decidedAt,
    rejectionReason: res.rejectionReason ?? null,
    rejectionNote: res.rejectionNote ?? null,
    revokedAt: parseTime(res.revokedAt),
    revocationReason: res.revocationReason ?? null,
    attemptsRemaining,
    retryAfter: parseTime(res.retryAfter),
    canRetry,
    verifiedAt: decidedAt,
    verifiedName: res.verifiedName ?? res.name ?? null,
    source: res.source ?? null,
    maskedAadhaar: res.maskedAadhaar ?? null,
    mobileMatch: res.mobileMatch ?? null,
    aadhaarMobile: '',
  };
}

export function toSubmissionPayload({ docType, consent, captures, liveness, challenge }) {
  const form = new FormData();
  form.set('docType', docType);
  form.set('consent', String(Boolean(consent)));
  form.set('consentLanguage', 'en');
  if (['passed', 'bypassed', 'unavailable'].includes(liveness)) form.set('liveness', liveness);
  if (challenge) form.set('challenge', challenge);
  if (captures?.front) form.set('front', captures.front);
  if (captures?.back) form.set('back', captures.back);
  if (captures?.selfie) form.set('selfie', captures.selfie);
  return form;
}

export function toSubmissionResult(res) {
  return {
    ...toVerificationViewModel(res),
    pending: (res?.status || 'none') === 'pending',
  };
}
