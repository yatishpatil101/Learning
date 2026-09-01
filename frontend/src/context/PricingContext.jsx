import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PRICING_DEFAULTS, getPricing } from '../services/settingsService.js';

const PricingContext = createContext(null);

/**
 * Reactive access to what PuneNest sells and for how much (`settings.fees`).
 *
 * ## Where these come from, and why it changed
 *
 * They used to be read straight out of `lib/store/billing.js`, whose `getFees()` consulted the
 * browser-local admin document and fell back to a bundled `FEE_DEFAULTS`. Live, neither source
 * existed: no signed-out visitor has that document, so every price the product quoted came from the
 * constant in the bundle. That is a worse failure than it sounds, because it never looked like one
 * — the plans page rendered, the checkout totalled, and an operator who changed a price in the
 * back office was told it saved. It did save. Nothing read it.
 *
 * The copy is the whole story. The same seven numbers lived in the bundle *and* in the seed row,
 * and while the browser never asked the server the two could not contradict each other, so they
 * drifted apart on five of the seven prices with nothing failing. A duplicated constant does not
 * drift loudly; it presents the bill in one go, on the day somebody finally reads. `GET /pricing`
 * is that read, and this provider is its only consumer.
 *
 * ## Why a provider rather than an async call at each site
 *
 * `fee()` was synchronous and is used inline in render by six screens — a plan card, a paywall, a
 * checkout line, a referral target. Making each of those await a fetch would put a spinner, or
 * worse a flash of a wrong number, in front of a price. Fetching once here and handing down a
 * synchronous reader keeps every call site exactly as simple as it was, which is what makes this a
 * repoint rather than a rewrite of six screens.
 *
 * ## The initial state is the defaults, not a loading gate
 *
 * `PRICING_DEFAULTS` is what a healthy install answers, so first paint shows the right prices and
 * the fetch only ever corrects an install whose operator has changed one. This is the opposite of
 * the Move-in Pack's fail-closed rule, deliberately: that page has a coming-soon mode to fall back
 * to, and a checkout does not — blanking the number strands a user mid-purchase rather than
 * protecting them. It is also why a failed fetch is silent and does not reset: re-asserting the
 * defaults could only ever *undo* a good earlier read, quietly restoring a price the operator had
 * changed.
 */
export function PricingProvider({ children }) {
  const [prices, setPrices] = useState(PRICING_DEFAULTS);

  useEffect(() => {
    /* Guards both against a superseded response overwriting a newer one and against a `setState`
       after unmount. A counter declared inside the effect rather than a `useRef` cleared in
       cleanup: under StrictMode the mount/cleanup/re-mount cycle leaves such a ref stuck at false
       for the life of the component, silently swallowing every result it ever gets. */
    let generation = 0;

    const sync = async () => {
      const mine = ++generation;
      try {
        const next = await getPricing();
        if (mine === generation && next) setPrices(next);
      } catch {
        /* Deliberately silent, and deliberately not a reset — see the note above on why falling
           back to the defaults here would undo a good read rather than recover from a bad one. */
      }
    };

    sync();
    // Same-tab: raised by whichever settings provider handled the write, so an admin changing a
    // price sees the consumer UI requote without a reload.
    window.addEventListener('punenest-settings-change', sync);
    // Cross-tab: the browser's own signal that another tab wrote to local storage. Load-bearing
    // only on the mock path; harmless live, where it costs one extra read of a public endpoint.
    window.addEventListener('storage', sync);
    return () => {
      generation += 1;
      window.removeEventListener('punenest-settings-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  /**
   * A price formatted for display, in rupees.
   *
   * Rendered through `toLocaleString('en-IN')` rather than a template string because Indian
   * grouping is not every-three-digits — 2499 is a plain number but 24999 is "24,999" and 249999 is
   * "2,49,999". This is the same formatting `fee()` did, moved rather than rewritten.
   */
  const fee = useCallback(
    (key) => '₹' + Number(prices[key] || 0).toLocaleString('en-IN'),
    [prices],
  );

  const value = useMemo(() => ({ fee, prices }), [fee, prices]);

  return (
    <PricingContext.Provider value={value}>
      {children}
    </PricingContext.Provider>
  );
}

export function usePricing() {
  const ctx = useContext(PricingContext);
  if (!ctx) throw new Error('usePricing must be used within PricingProvider');
  return ctx;
}
