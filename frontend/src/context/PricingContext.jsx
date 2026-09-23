import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PRICING_DEFAULTS, getPricing } from '../services/settingsService.js';

const PricingContext = createContext(null);

/* `settings.fees` read once from `GET /pricing` and handed down as a synchronous reader, so the six
   screens that quote a price inline in render never await or flash. The fetch is deferred until a
   priced screen calls `usePricing()`, and a failed read keeps the last answer rather than resetting. */
export function PricingProvider({ children }) {
  const [prices, setPrices] = useState(PRICING_DEFAULTS);
  const [active, setActive] = useState(false);

  /* Raised by `usePricing()` on mount. Idempotent by construction — the state only ever goes
     false → true, so the effect below runs once however many priced screens ask. */
  const activate = useCallback(() => setActive(true), []);

  useEffect(() => {
    /* The listeners wait too: a price edited while nobody is looking is picked up by the fetch
       that runs when somebody finally looks. */
    if (!active) return undefined;

    /* A counter declared inside the effect rather than a `useRef` cleared in cleanup: under
       StrictMode such a ref stays false for the component's life, swallowing every result. */
    let generation = 0;

    const sync = async () => {
      const mine = ++generation;
      try {
        const next = await getPricing();
        if (mine === generation && next) setPrices(next);
      } catch {
        /* Deliberately not a reset — falling back to the defaults would undo a good earlier read
           rather than recover from a bad one. */
      }
    };

    sync();
    // Same-tab: raised by whichever settings provider handled the write, so an admin changing a
    // price sees the consumer UI requote without a reload.
    window.addEventListener('draazy-settings-change', sync);
    // Cross-tab: the browser's own signal that another tab wrote to local storage.
    window.addEventListener('storage', sync);
    return () => {
      generation += 1;
      window.removeEventListener('draazy-settings-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, [active]);

  /* `toLocaleString('en-IN')` rather than a template string: Indian grouping is not
     every-three-digits — 24999 is "24,999" but 249999 is "2,49,999". */
  const fee = useCallback(
    (key) => '₹' + Number(prices[key] || 0).toLocaleString('en-IN'),
    [prices],
  );

  const value = useMemo(() => ({ fee, prices, activate }), [fee, prices, activate]);

  return (
    <PricingContext.Provider value={value}>
      {children}
    </PricingContext.Provider>
  );
}

/* `activate()` is declared above the missing-provider throw deliberately: an early return before a
   hook is the conditional call the rules of hooks forbid. */
export function usePricing() {
  const ctx = useContext(PricingContext);
  const activate = ctx?.activate;
  useEffect(() => { activate?.(); }, [activate]);
  if (!ctx) throw new Error('usePricing must be used within PricingProvider');
  return ctx;
}
