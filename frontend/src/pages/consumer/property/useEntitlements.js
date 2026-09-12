/**
 * The signed-in user's entitlements, as React state.
 *
 * Same shape of problem as `useContactGate`, and the same answer: what used to be a synchronous
 * localStorage read (`contactsRemaining()`) is now a network read, so every consumer needs an
 * effect to fetch it, something safe to render before it lands, and a way to refresh it after the
 * user has spent one. ContactBox, ContactOwnerModal and the exhausted modal all want the same
 * numbers, so the fetching lives here once.
 *
 * ## `null` is not zero
 *
 * `entitlements` is `null` until the answer arrives, and stays `null` for a signed-out visitor and
 * for a request that failed. None of those three mean "you have no contacts left" — they mean there
 * is no number to show — so consumers must render nothing rather than "0 left". The `remaining`
 * field is *also* `null` on an unlimited plan, for a different reason again, which is why
 * `unlimited` is a separate boolean and not something to be inferred from the numbers.
 *
 * ## This hook does not gate anything
 *
 * It reports. `POST /contacts/request` refuses, with a 422 the caller catches. Reading `remaining`
 * and skipping the request when it hits zero would put the decision back in the browser, which is
 * precisely what D31b removed — and it would be wrong as well as unsafe, since another tab or
 * device may have spent or earned contacts since this fetch.
 */
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

/**
 * Owner contacts left, or `null` when there is no number worth showing — not loaded yet, signed
 * out, or on a plan with no ceiling. Callers render the counter only when this is a finite number.
 */
export const contactsLeft = (entitlements) => {
  const c = entitlements?.contacts;
  if (!c || c.unlimited) return null;
  return Number.isFinite(c.remaining) ? c.remaining : null;
};
