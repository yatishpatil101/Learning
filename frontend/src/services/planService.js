/** The caller's subscription plan and the catalogue, held in `context/PlanContext.jsx` so render-time questions are answered from memory.
 * `pending` is not `active`: a priced plan is granted only by the payment webhook, and `id` is `'free'` for any non-active plan. */
import { createProvider } from './config.js';

const provider = createProvider('plan');

/** Public: the pricing page must render for the signed-out visitors it exists to convert. */
export const listPlans = async () => (await provider()).listPlans();

/** Resolves to the free tier when signed out, since the paywall and pricing page render for visitors. */
export const getSubscription = async () => (await provider()).getSubscription();

/** A priced plan returns a `pending` subscription, not `active`: read `status` before telling anyone they have it.
 * Idempotent per plan, so a double-tapped Pay returns the original order. */
export const subscribe = async (slug, paymentMethod) => (await provider()).subscribe(slug, paymentMethod);
