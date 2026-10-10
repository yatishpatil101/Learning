import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSubscription, subscribe as subscribeToPlan } from '../services/planService.js';
import { useAuth } from './AuthContext.jsx';

/** The free tier is the floor, never an error: failing open would grant a paid entitlement on a timeout.
 * Buying does not grant: a priced plan stays `pending` until the payment webhook, so read `status`. */
const PlanContext = createContext(null);

/** What every consumer sees before the first load settles, and whenever there is no session. */
const FREE_TIER = {
  subscriptionId: null,
  id: 'free',
  name: 'Free',
  status: null,
  pendingSlug: null,
  paymentRef: null,
  paymentSessionId: null,
  isPaidOwner: false,
  listingLimit: 1,
};

export function PlanProvider({ children }) {
  const { isIn } = useAuth();
  const [plan, setPlan] = useState(FREE_TIER);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getSubscription();
    setPlan(next);
    return next;
  }, []);

  useEffect(() => {
    if (!isIn) {
      setPlan(FREE_TIER);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    getSubscription()
      .then((next) => { if (alive) setPlan(next); })
      // An unreachable plan reads as the free tier. See the note above: under-granting is
      // recoverable (the user sees an upgrade prompt they can act on); over-granting is not.
      .catch(() => { if (alive) setPlan(FREE_TIER); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isIn]);

  /** Not optimistic: a plan that flips early claims a payment succeeded before the gateway has said so. */
  const subscribe = useCallback(async (slug, paymentMethod) => {
    const next = await subscribeToPlan(slug, paymentMethod);
    setPlan(next);
    return next;
  }, []);

  const value = useMemo(() => ({
    plan,
    planId: plan.id,
    planName: plan.name,
    status: plan.status,
    isPaidOwner: plan.isPaidOwner,
    /* The plan's own ceiling; referral bonus slots are added by the caller, since referrals are still
       localStorage, and folding them in here would misstate what the plan allows. */
    listingLimit: plan.listingLimit,
    loading,
    refresh,
    subscribe,
  }), [plan, loading, refresh, subscribe]);

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

/** Null-safe outside the provider, so a component rendered in isolation degrades to the free tier. */
export function usePlan() {
  return useContext(PlanContext) ?? EMPTY;
}

const EMPTY = {
  plan: FREE_TIER,
  planId: 'free',
  planName: 'Free',
  status: null,
  isPaidOwner: false,
  listingLimit: 1,
  loading: false,
  refresh: async () => FREE_TIER,
  subscribe: async () => FREE_TIER,
};
