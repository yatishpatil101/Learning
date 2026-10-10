/** `listPlans` does not short-circuit without a session, because the pricing page
 * must render for the signed-out visitors it exists to convert. */
import { get, post } from '../../http.js';
import { readAccessToken } from '../../../lib/auth.js';
import { bootstrapSection } from './bootstrap.js';
import { planNameForSlug, toPlanCatalogueEntry, toPlanViewModel } from './planMapper.js';

/** The plan catalogue, newest-priced-last as the server orders it. Public. */
export async function listPlans() {
  const rows = await bootstrapSection('plans');
  return (Array.isArray(rows) ? rows : []).map(toPlanCatalogueEntry);
}

/** The subscription carries a plan UUID, so both are fetched together; a signed-out caller
 * gets the free tier locally because the endpoint could only answer 401. */
export async function getSubscription() {
  if (!readAccessToken()) return toPlanViewModel(null, []);
  const [row, plans] = await Promise.all([
    get('/me/subscription'),
    listPlans(),
  ]);
  return toPlanViewModel(row, plans);
}

/** Does not grant the plan: a priced plan stays `pending` until the signature-verified webhook activates it.
 * Idempotency-Key derives from the plan choice, so a double-tapped Pay returns the original order. */
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
  return toPlanViewModel(row, plans);
}
