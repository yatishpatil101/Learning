import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAadhaarStatus, submitIdentityVerification } from '../services/verificationService.js';
import { NONE_VERIFICATION } from '../services/providers/http/verificationMapper.js';
import { useAuth } from './AuthContext.jsx';

/**
 * The caller's opt-in identity-verification state, fetched once for the whole app because seven
 * render paths ask for it. Badge, never a wall (ADR-019): an unreachable badge reads as `none`.
 */
const VerificationContext = createContext(null);

/** What every consumer sees before the first load settles, and whenever there is no session. Both
    the render floor (NONE) and the outside-provider fallback (EMPTY) derive from the mapper's single
    frozen floor shape, so the badge fields cannot drift between the three places that restate them. */
const NONE = { ...NONE_VERIFICATION };

const EMPTY = {
  ...NONE_VERIFICATION,
  loading: false,
  refresh: async () => NONE,
  submitVerification: async () => NONE,
};

export function VerificationProvider({ children }) {
  const { isIn } = useAuth();
  const [badge, setBadge] = useState(NONE);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getAadhaarStatus();
    setBadge(next);
    return next;
  }, []);

  useEffect(() => {
    if (!isIn) {
      setBadge(NONE);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    getAadhaarStatus()
      .then((next) => { if (alive) setBadge(next); })
      // An unreachable badge reads as none. Under-stating trust is recoverable (the user sees a
      // nudge they can act on); over-stating it would put a "Verified" ribbon on an unproven account.
      .catch(() => { if (alive) setBadge(NONE); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isIn]);

  const submitVerification = useCallback(async (details) => {
    const next = await submitIdentityVerification(details);
    setBadge((current) => ({ ...current, ...next }));
    return next;
  }, []);

  const value = useMemo(() => ({
    verified: badge.verified,
    status: badge.status,
    docType: badge.docType,
    docLast4: badge.docLast4,
    maskedDocument: badge.maskedDocument,
    submittedAt: badge.submittedAt,
    decidedAt: badge.decidedAt,
    rejectionReason: badge.rejectionReason,
    rejectionNote: badge.rejectionNote,
    attemptsRemaining: badge.attemptsRemaining,
    retryAfter: badge.retryAfter,
    canRetry: badge.canRetry,
    source: badge.source,
    maskedAadhaar: badge.maskedAadhaar,
    mobileMatch: badge.mobileMatch,
    verifiedAt: badge.verifiedAt,
    aadhaarMobile: badge.aadhaarMobile,
    loading,
    refresh,
    submitVerification,
  }), [badge, loading, refresh, submitVerification]);

  return <VerificationContext.Provider value={value}>{children}</VerificationContext.Provider>;
}

/** Null-safe outside the provider, so a component rendered in isolation degrades to the none tier. */
export function useVerification() {
  return useContext(VerificationContext) ?? EMPTY;
}
