/**
 * Cashfree hosted-checkout bridge (Option A).
 *
 * The server opens the order and hands back a single-use `payment_session_id`; the browser's only
 * job is to render Cashfree's own hosted checkout against it. It never sees the merchant key or
 * secret — those live in the backend — and it never decides whether the payment succeeded. The
 * signature-verified payment webhook is what activates the subscription; `checkout()` resolving
 * means the modal closed, not that money moved. The caller re-reads `/me/subscription` afterwards.
 *
 * ## Mode
 *
 * `sandbox` against Cashfree's test environment (the `TEST_` keys), `production` against live. Set
 * `VITE_CASHFREE_MODE=production` for a live build; sandbox is the safe default so a misconfigured
 * env can only ever hit test rails, never charge a real card.
 *
 * ## Why the SDK loads lazily and once
 *
 * `load()` injects Cashfree's script and is the only heavy import in the checkout path. It is
 * memoised so a customer who abandons and retries does not pull the SDK twice, and it is dynamic so
 * the ~tens-of-KB dependency stays out of every bundle that never reaches the pay button.
 */
const MODE = import.meta.env.VITE_CASHFREE_MODE || 'sandbox';

/** @type {Promise<object>|null} The one in-flight (or settled) SDK instance. */
let sdkPromise = null;

function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import('@cashfreepayments/cashfree-js')
      .then(({ load }) => load({ mode: MODE }))
      // A failed load must not be cached — a flaky network on the first click should not doom every
      // retry to the same rejected promise.
      .catch((err) => { sdkPromise = null; throw err; });
  }
  return sdkPromise;
}

/**
 * Open Cashfree's hosted checkout for a server-issued payment session, in a modal over the app.
 *
 * Resolves when the modal closes — regardless of the payment outcome, which only the webhook can
 * confirm. Rejects only if the SDK itself fails to load or open.
 *
 * <p>**`mock_session_*` never reaches the SDK.** When `punenest.providers.cashfree.enabled` is
 * false the backend's `MockPaymentGateway` mints a deterministic fake order so the pay flow is, in
 * its own words, "fully demoable with no merchant account" — which is what dev, e2e and every
 * screenshot build run on. Handing that id to the real SDK broke that promise from this side: the
 * script loaded, Cashfree rejected a session it never issued, and the caller's `catch` painted "we
 * couldn't start that payment" over a subscription the server had just created quite happily. The
 * prefix is the gateway's own contract, so recognising it here is cheaper and safer than teaching
 * each call site a second notion of "is payment configured" that could drift from the server's.
 *
 * @param {string} paymentSessionId the `payment_session_id` from `POST /me/subscription`
 * @returns {Promise<object>} Cashfree's checkout result (`{ error?, redirect?, paymentDetails? }`),
 *   or `{ mock: true }` when the server is running without a merchant account
 */
export async function openCashfreeCheckout(paymentSessionId) {
  if (String(paymentSessionId ?? '').startsWith('mock_session_')) return { mock: true };
  const cashfree = await loadSdk();
  return cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' });
}
