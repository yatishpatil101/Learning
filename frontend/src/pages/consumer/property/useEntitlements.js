/* `null` is not zero: it means "no number to show" (not loaded, signed out, or failed), so consumers
   render nothing rather than "0 left". This hook reports only — `POST /contacts/request` refuses. */
import { useCallback, useEffect, useState } from 'react';
import { getEntitlements } from '../../../services/entitlementService.js';

export function useEntitlements(enabled = true) {
  const [entitlements, setEntitlements] = useState(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setEntitlements(null);
      return null;
    }
    try {
      const next = await getEntitlements();
      setEntitlements(next);
      return next;
    } catch {
      // Signed out, offline, or the endpoint is unhappy. Showing no counter is honest; showing a
      // stale or invented one is not.
      setEntitlements(null);
      return null;
    }
  }, [enabled]);

  useEffect(() => {
    let alive = true;
    if (!enabled) {
      setEntitlements(null);
      return undefined;
    }
    getEntitlements()
      .then((next) => { if (alive) setEntitlements(next); })
      .catch(() => { if (alive) setEntitlements(null); });
    return () => { alive = false; };
  }, [enabled]);

  return { entitlements, refresh };
}

/** Owner contacts left, or `null` when there is no number worth showing — not loaded yet, signed
 *  out, or on a plan with no ceiling. Callers render the counter only for a finite number. */
export const contactsLeft = (entitlements) => {
  const c = entitlements?.contacts;
  if (!c || c.unlimited) return null;
  return Number.isFinite(c.remaining) ? c.remaining : null;
};
