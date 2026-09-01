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
 * ## Why the fetch waits for a consumer
 *
 * The provider sits in `ConsumerLayout`, so it is mounted on every consumer route, but the four
 * screens that quote a price are all route-level (`/plans`, `/checkout`, `/refer`, and the listing
 * paywall). Fetching on mount therefore spent a request on the home page, search,
 * every property detail — none of which render a number from here. `usePricing()` flips `active`
 * on mount instead, so the read happens on the first route that can actually display the answer
 * and not before. Once flipped it stays flipped for the life of the layout: navigating between
 * two priced screens does not re-ask, which is the behaviour the eager version had and the reason
 * this is a deferral rather than a per-screen fetch.
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
 *
 * ## What deferring costs, and where it is sharpest
 *
 * On an install whose operator *has* changed a price, the paragraph above is a statement about a
 * window, not about correctness: between first paint and the response, a priced screen shows the
 * bundled number. Deferring did not create that window — a deep link to `/checkout`, or a refresh
 * on `/plans`, has always mounted the provider and the page in the same commit and so has
 * always painted the defaults for one round trip. What deferring did was widen it from "arrived by
 * URL" to "arrived by URL *or* by clicking through", because the eager read used to have finished
 * during the visit to whatever unpriced page came before.
 *
 * All four consumers only display through it, so the window is cosmetic: `/checkout` charges the
 * server's subscription regardless (`serverPrice ?? base.price`), the plan card and the listing
 * paywall prefer the `/plans` catalogue and fall through to `fee()` only when it is unreachable,
 * and `/refer` quotes a reward. The one screen that used to *compute* a charge from these numbers
 * — the rent-pay convenience fee — was withdrawn along with that rail, which is why nothing here
 * needs a "a read has landed" signal and why the provider stays lazy.
 */
export function PricingProvider({ children }) {
  const [prices, setPrices] = useState(PRICING_DEFAULTS);
  const [active, setActive] = useState(false);

  /* Raised by `usePricing()` on mount. Idempotent by construction — the state only ever goes
     false → true, so React bails out of every call after the first and the effect below runs once
     however many priced screens ask. */
  const activate = useCallback(() => setActive(true), []);

  useEffect(() => {
    /* No consumer has asked yet, so there is nothing this answer could change on screen. The
       listeners wait too: a price the operator edits while nobody is looking is picked up by the
       fetch that runs when somebody finally does. */
    if (!active) return undefined;

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
  }, [active]);

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

  const value = useMemo(() => ({ fee, prices, activate }), [fee, prices, activate]);

  return (
    <PricingContext.Provider value={value}>
      {children}
    </PricingContext.Provider>
  );
}

/**
 * Read prices, and tell the provider somebody is looking.
 *
 * The `activate()` effect is what makes the fetch lazy, so it has to run for every caller rather
 * than only the first — the provider, not the hook, is what dedupes. It is declared above the
 * missing-provider throw deliberately: an early return before a hook is exactly the conditional
 * call the rules of hooks forbid, and a component either always has the provider above it or never
 * does, so the throw is unconditional in practice and the effect never commits when it fires.
 */
export function usePricing() {
  const ctx = useContext(PricingContext);
  const activate = ctx?.activate;
  useEffect(() => { activate?.(); }, [activate]);
  if (!ctx) throw new Error('usePricing must be used within PricingProvider');
  return ctx;
}
