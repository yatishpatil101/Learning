import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAadhaarStatus, submitIdentityVerification, withdrawIdentityVerification } from '../services/verificationService.js';
import { NONE_VERIFICATION } from '../services/providers/http/verificationMapper.js';
import { useAuth } from './AuthContext.jsx';

/* App-wide verification is a badge, never a wall; unreachable state reads as `none`. */
const VerificationContext = createContext(null);

/* Render floor and outside-provider fallback both derive from the mapper's empty state. */
const NONE = { ...NONE_VERIFICATION };

const EMPTY = {
  ...NONE_VERIFICATION,
  loading: false,
  refresh: async () => NONE,
  submitVerification: async () => NONE,
  withdrawVerification: async () => NONE,
};

export function VerificationProvider({ children }) {
  const { isIn } = useAuth();
  const [badge, setBadge] = useState(NONE);
  const [loading, setLoading] = useState(false);
  // Until the first read lands a consumer must not take `verified: false` as an answer.
  const [settled, setSettled] = useState(false);
  // Read only once a screen asks: the shell itself draws no badge.
  const [wanted, setWanted] = useState(false);
  const want = useCallback(() => setWanted(true), []);

  const refresh = useCallback(async () => {
    const next = await getAadhaarStatus();
    setBadge(next);
    return next;
  }, []);

  useEffect(() => {
    if (!isIn) {
      setBadge(NONE);
      setSettled(false);
      return undefined;
    }
    if (!wanted) return undefined;
    let alive = true;
    setLoading(true);
    getAadhaarStatus()
      .then((next) => { if (alive) setBadge(next); })
      // An unreachable badge reads as none. Under-stating trust is recoverable (the user sees a
      // nudge they can act on); over-stating it would put a "Verified" ribbon on an unproven account.
      .catch(() => { if (alive) setBadge(NONE); })
      .finally(() => { if (alive) { setLoading(false); setSettled(true); } });
    return () => { alive = false; };
  }, [isIn, wanted]);

  const submitVerification = useCallback(async (details) => {
    const next = await submitIdentityVerification(details);
    setBadge((current) => ({ ...current, ...next }));
    return next;
  }, []);

  const withdrawVerification = useCallback(async () => {
    const next = await withdrawIdentityVerification();
    setBadge(next);
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
    revokedAt: badge.revokedAt,
    revocationReason: badge.revocationReason,
    attemptsRemaining: badge.attemptsRemaining,
    retryAfter: badge.retryAfter,
    canRetry: badge.canRetry,
    source: badge.source,
    maskedAadhaar: badge.maskedAadhaar,
    mobileMatch: badge.mobileMatch,
    verifiedAt: badge.verifiedAt,
    aadhaarMobile: badge.aadhaarMobile,
    loading: loading || (isIn && !settled),
    want,
    refresh,
    submitVerification,
    withdrawVerification,
  }), [badge, loading, isIn, settled, want, refresh, submitVerification, withdrawVerification]);

  return <VerificationContext.Provider value={value}>{children}</VerificationContext.Provider>;
}

/** Null-safe outside the provider, so a component rendered in isolation degrades to the none tier. */
export function useVerification() {
  const ctx = useContext(VerificationContext);
  const want = ctx?.want;
  useEffect(() => { want?.(); }, [want]);
  return ctx ?? EMPTY;
}
