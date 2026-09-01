import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAadhaarStatus, startAadhaar } from '../services/verificationService.js';
import { NONE_VERIFICATION } from '../services/providers/http/verificationMapper.js';
import { useAuth } from './AuthContext.jsx';

/**
 * The caller's opt-in Aadhaar "Verified" badge, held once for the whole app.
 *
 * ## Why this exists
 *
 * The badge answers a question the app asks *during render* — whether to draw a "Verified" ribbon or
 * a "get verified" nudge — in seven places (profile, dashboard, flatmate supply, two nudges, the
 * owner-overview panel, the contact modal) plus the tenant-profile mirror. Those were synchronous
 * localStorage reads; against an API each is a network call. Fetched once here and answered from
 * memory, same shape as `PlanContext`/`SavedContext`.
 *
 * ## A badge, never a wall (ADR-019)
 *
 * `verified` decides what to *show*, never what to *allow*. Nothing on the client is gated on it; the
 * one gate that reads identity is the server's contact service, untouched by this. So the unverified
 * floor is the safe default: an unreachable badge reads as `none`, which can only under-state trust.
 *
 * ## Starting does not grant, live
 *
 * `startVerification` returns a pending DigiLocker consent handle. The server grants the badge only
 * when the signed webhook lands, so callers hand the handle to the modal for redirect and re-read on
 * the next app visit. See `services/verificationService.js`.
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
  startVerification: async () => NONE,
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

  /**
   * Begin (or retry) DigiLocker verification.
   *
   * The server returns a pending handle and the badge stays unverified until the webhook lands.
   * Return the handle so the modal can redirect the browser.
   */
  const startVerification = useCallback((details) => startAadhaar(details), []);

  const value = useMemo(() => ({
    verified: badge.verified,
    status: badge.status,
    source: badge.source,
    maskedAadhaar: badge.maskedAadhaar,
    mobileMatch: badge.mobileMatch,
    verifiedAt: badge.verifiedAt,
    aadhaarMobile: badge.aadhaarMobile,
    loading,
    refresh,
    startVerification,
  }), [badge, loading, refresh, startVerification]);

  return <VerificationContext.Provider value={value}>{children}</VerificationContext.Provider>;
}

/** Null-safe outside the provider, so a component rendered in isolation degrades to the none tier. */
export function useVerification() {
  return useContext(VerificationContext) ?? EMPTY;
}
