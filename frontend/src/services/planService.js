/**
 * Plan Service — the subscription plan a caller holds, and the catalogue they can buy from.
 *
 * `GET /plans` (public) · `GET /me/subscription` · `POST /me/subscription`.
 *
 * ## Why this domain needed a context, not just a service
 *
 * Every other seam domain answers a question a component can await. This one answers questions the
 * app has always asked **during render**:
 *
 *   `isPaidOwnerPlan()`   MyListingsPanel, deciding whether to offer the Feature action
 *   `getPlan().id`        Plans page (which card is current), Checkout (already-owned guard)
 *
 * Those are synchronous reads of a localStorage value. Against an API they are a network call, and
 * the naive conversion — `await` in each of six places — means six requests to draw one dashboard
 * and six copies of the answer that drift the moment one of them changes.
 *
 * The listing quota is deliberately **not** served from here: the ceiling is not a property of the
 * plan alone — referrals raise it, and the count it is measured against lives in the listings
 * table, not in this browser. Both halves come from `GET /me/entitlements` and `GET /me/listings`
 * via `lib/data/listingQuota.js`.
 *
 * So the plan is fetched once and held in `context/PlanContext.jsx`, and the sync questions are
 * answered from memory. This is the same shape `SavedContext` uses for the shortlist and
 * `SavedSearchContext` for alerts, for the same reason.
 *
 * ## `pending` is not `active`
 *
 * The single most important thing this domain carries. `POST /me/subscription` on a priced plan
 * does **not** grant it: the server creates the row `pending` against a payment-gateway order and
 * only the signature-verified payment webhook moves it to `active`. A free plan is active at once,
 * because there is no money to wait for.
 *
 * No call site may be written against "pay, then you have it". `Checkout.jsx` reads the returned
 * status and says what actually happened.
 *
 * ## Shape
 *
 *   { subscriptionId, id, name, status, pendingSlug, paymentRef,
 *     startedAt, renewsAt, isPaidOwner, listingLimit }
 *
 * `id` and `name` carry the pricing vocabulary (`'owner2'`, `'Owner Plus'`), which the pricing
 * card, the billing panel and the checkout guard all read. `id` is `'free'` for
 * an unsubscribed, pending, lapsed or unrecognised plan — the free tier is the floor, never an
 * error state.
 */
import { createProvider } from './config.js';

const provider = createProvider('plan');

/**
 * The plan catalogue. **Public** — this is the pricing page, which has to render for the
 * signed-out visitor it exists to convert.
 *
 * The server's plan row is itself the price — it is not read from the back-office Fees panel.
 *
 * @returns {Promise<{id, slug, name, audience, price, billingCycle, features}[]>}
 */
export const listPlans = async () => (await provider()).listPlans();

/**
 * The caller's current plan. Resolves to the free tier for a signed-out caller rather than
 * throwing — the paywall and the pricing page both render for visitors.
 */
export const getSubscription = async () => (await provider()).getSubscription();

/**
 * Buy a plan.
 *
 * **Returns the resulting subscription, which for a priced plan is `pending`, not `active`.** Read
 * `status` before telling anyone they have the plan. Sending them away believing a purchase landed
 * when the gateway has not confirmed it is the one outcome worth designing against here.
 *
 * Idempotent per plan: a double-tapped Pay button returns the original order rather than opening a
 * second one.
 *
 * @param {string} slug `owner2` | `owner5` | `seeker-plus`
 * @param {string} [paymentMethod] `upi` | `card` | `netbanking`
 */
export const subscribe = async (slug, paymentMethod) => (await provider()).subscribe(slug, paymentMethod);
