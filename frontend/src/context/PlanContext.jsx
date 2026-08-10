import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSubscription, subscribe as subscribeToPlan } from '../services/planService.js';
import { useAuth } from './AuthContext.jsx';

/**
 * The caller's subscription plan, held once for the whole app.
 *
 * ## Why this exists
 *
 * The plan answers questions the app asks *during render* — whether to offer the Feature action,
 * how many listings the paywall allows, which pricing card is current. Those were synchronous
 * localStorage reads. Against an API each one is a network call, and converting them in place would
 * mean six requests to draw one dashboard plus six copies of the answer free to disagree the moment
 * a purchase changes one of them.
 *
 * So the plan is fetched once and the sync questions are answered from memory. Same shape as
 * `SavedContext` (shortlist membership) and `SavedSearchContext` (alerts), for the same reason.
 *
 * ## The free tier is the floor, never an error
 *
 * A signed-out visitor, an unreachable API, a lapsed subscription and a plan the app has no card
 * for all resolve to `{ id: 'free', listingLimit: 1, isPaidOwner: false }`. That is the safe
 * direction: it can only ever *under*-grant. Failing open would hand somebody a paid entitlement
 * because a request timed out.
 *
 * ## Buying does not grant
 *
 * `subscribe` returns the resulting subscription and refreshes this context, but for a priced plan
 * that subscription is `pending` — the payment webhook is what activates it, and no browser can
 * make that happen. Consumers must read `status`; `isPaidOwner` stays false until the money lands.
 */
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
  startedAt: null,
  renewsAt: null,
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

  /**
   * Buy a plan, then re-read.
   *
   * Deliberately **not** optimistic, unlike the saved-property heart. A heart that flips early is
   * corrected a moment later at no cost; a plan that flips early tells someone a payment succeeded
   * before the gateway has said so. The returned subscription is what the caller should render.
   */
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
    /* The plan's own ceiling. Referral bonus slots are added by the caller (`Refer.jsx`,
       `ListProperty`) because referrals are still a localStorage domain — folding them in here
       would make this context lie about what the *plan* allows. */
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
