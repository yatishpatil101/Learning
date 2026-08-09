/**
 * HTTP plan provider — the live counterpart to `providers/mock/planProvider.js`.
 *
 * `GET /plans` (public) · `GET /me/subscription` · `POST /me/subscription`.
 *
 * The catalogue read is public and the two subscription operations are caller-scoped, so this is
 * the first domain where one provider spans both. `listPlans` therefore does **not** short-circuit
 * on a missing session: the pricing page has to render for a signed-out visitor, who is exactly the
 * person it exists to convert.
 */
import { get, post } from '../../http.js';
import { readAccessToken } from '../../../lib/auth.js';
import { planNameForSlug, toPlanCatalogueEntry, toPlanViewModel } from './planMapper.js';

/** The plan catalogue, newest-priced-last as the server orders it. Public. */
export async function listPlans() {
  const rows = await get('/plans');
  return (Array.isArray(rows) ? rows : []).map(toPlanCatalogueEntry);
}

/**
 * The caller's current plan, resolved against the catalogue.
 *
 * Two requests, not one, because the subscription carries a plan **UUID** and every consumer needs
 * the slug, the name and the listing ceiling that only the catalogue can supply. They are issued
 * together rather than in sequence — neither depends on the other's result, and the pricing page
 * and the dashboard both block on this.
 *
 * A signed-out caller is answered locally with the free tier. The endpoint is caller-scoped, so the
 * server could only ever say 401, and asking is a round trip whose answer is already known — the
 * same reasoning the contact gate uses.
 */
export async function getSubscription() {
  if (!readAccessToken()) return toPlanViewModel(null, []);
  const [row, plans] = await Promise.all([
    get('/me/subscription'),
    listPlans(),
  ]);
  return toPlanViewModel(row, plans.map((p) => ({ id: p.id, name: p.name })));
}

/**
 * Subscribe to a plan.
 *
 * **This does not grant the plan.** For a priced plan the server creates the subscription
 * `pending` against a gateway order and returns the order id; only the signature-verified payment
 * webhook moves it to `active`. A free plan is active immediately. The caller gets the resulting
 * view model and must read `status` rather than assuming success means entitlement — see
 * `planMapper.isEntitled`.
 *
 * `Idempotency-Key` is the contract's, and it is what makes a double-tapped Pay button safe: a
 * repeat returns the original row instead of opening a second gateway order against the same
 * intent. The key is derived from the caller's plan choice rather than randomised, because a
 * random key per click is not idempotency, it is a new order every time.
 *
 * @param {string} slug the app's plan slug (`owner2`, `owner5`, `seeker-plus`)
 * @param {string} [paymentMethod] `upi` | `card` | `netbanking`
 */
export async function subscribe(slug, paymentMethod = 'upi') {
  const plans = await listPlans();
  const name = planNameForSlug(slug);
  const plan = plans.find((p) => p.name === name);
  if (!plan) {
    // A slug with no catalogue row is a broken link or a plan that was withdrawn. Failing loudly
    // beats posting a `planId` of `undefined` and reading the 400 as a payment problem.
    throw new Error(`[plan] No catalogue plan for "${slug}". The pricing card and the server disagree.`);
  }
  const row = await post('/me/subscription', { planId: plan.id, paymentMethod }, {
    headers: { 'Idempotency-Key': `sub:${plan.id}` },
  });
  return toPlanViewModel(row, plans.map((p) => ({ id: p.id, name: p.name })));
}
