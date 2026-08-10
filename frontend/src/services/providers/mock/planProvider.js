/**
 * Mock plan provider — the localStorage counterpart to `providers/http/planProvider.js`.
 *
 * Wraps the plan half of `lib/store/billing.js` and shapes it into the same view model the http
 * provider returns, so the pricing page, the billing panel and the paywall read one vocabulary.
 *
 * ## The one place this deliberately matches the server rather than the old mock
 *
 * `setPlan()` granted a plan the instant it was called, because a localStorage write cannot fail.
 * The server does not work that way: a **priced** plan is created `pending` against a payment
 * gateway order and is only moved to `active` by the signature-verified payment webhook.
 *
 * So `subscribe` here returns `pending` for a priced plan too, and does **not** write the plan into
 * the entitlement key. Anything else and a call site could be written against the gentler behaviour
 * — "pay, then you have it" — and would silently break on the day the domain went live, which is
 * the whole failure mode the parity harness exists to catch.
 *
 * The mock still needs a way to *become* entitled, or every downstream flow (featuring a listing,
 * the second-listing paywall) becomes untestable. `mockActivateSubscription` is that: the local
 * stand-in for the payment webhook, and named so it cannot be mistaken for something the browser
 * does in production.
 */
import { getPlan, setPlan, getFees } from '../../../lib/store.js';
import {
  PAID_OWNER_PLAN_SLUGS,
  planNameForSlug,
} from '../http/planMapper.js';

/** The catalogue, mirroring the seeded rows so the two providers agree on names, prices and order. */
const CATALOGUE = [
  { id: 'mock-plan-owner-free', slug: 'owner-free', name: 'Owner Free', audience: 'owner', price: 0, billingCycle: 'yearly', listingLimit: 1, contactLimit: null, features: ['1 live listing', 'Verified owner badge', 'Unlimited enquiries'] },
  { id: 'mock-plan-owner-plus', slug: 'owner2', name: 'Owner Plus', audience: 'owner', price: 2499, billingCycle: 'yearly', listingLimit: 2, contactLimit: null, features: ['2 live listings', 'Self-serve boosts', 'Priority support'] },
  { id: 'mock-plan-owner-pro', slug: 'owner5', name: 'Owner Pro', audience: 'owner', price: 4999, billingCycle: 'yearly', listingLimit: 5, contactLimit: null, features: ['5 live listings', 'Self-serve boosts', 'Rent agreement included', 'Dedicated manager'] },
  { id: 'mock-plan-seeker-plus', slug: 'seeker-plus', name: 'Seeker Plus', audience: 'tenant', price: 299, billingCycle: 'monthly', listingLimit: null, contactLimit: null, features: ['Unlimited owner contacts', 'Instant alerts', 'Saved-search priority'] },
];

/** Live-listing ceiling for a plan slug, from the catalogue above. Unknown or uncapped → the floor. */
const listingLimitForSlug = (slug) => CATALOGUE.find((p) => p.slug === slug)?.listingLimit ?? 1;

const PENDING_KEY = 'pnPendingSubscription';

const readPending = () => {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
};
const writePending = (v) => {
  try {
    if (v) localStorage.setItem(PENDING_KEY, JSON.stringify(v));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* private mode — a lost pending marker degrades to "no purchase in flight" */ }
};

/**
 * Prices come from the admin Fees panel here, not from the catalogue constant above.
 *
 * That is the mock's own source of truth (`getFees()`), and the back-office can change it at
 * runtime — so reading the constant would make the pricing page disagree with the panel that sets
 * it. The server has no such indirection: its plan row *is* the price. The parity harness treats
 * that as a tolerated difference rather than a break, because both answers are correct for their
 * own world.
 */
const pricedCatalogue = () => {
  const fees = getFees();
  const override = {
    owner2: fees.ownerPlanYearly,
    owner5: fees.ownerProYearly,
    'seeker-plus': fees.seekerPlusTopup,
  };
  return CATALOGUE.map((p) => (
    override[p.slug] === undefined ? p : { ...p, price: Number(override[p.slug]) }
  ));
};

export async function listPlans() {
  return pricedCatalogue();
}

/** The caller's current plan, in the same view model the http provider returns. */
export async function getSubscription() {
  const held = getPlan();
  const slug = held?.id && held.id !== 'free' ? held.id : null;
  const pending = readPending();
  const entitled = !!slug;

  return {
    subscriptionId: entitled ? `mock-sub-${slug}` : null,
    id: entitled ? slug : 'free',
    name: entitled ? (planNameForSlug(slug) || held.name || 'Free') : 'Free',
    status: entitled ? 'active' : (pending ? 'pending' : null),
    pendingSlug: pending?.slug ?? null,
    paymentRef: pending?.paymentRef ?? null,
    // The mock has no real gateway, so no hosted-checkout session — the http provider supplies
    // this on a live subscribe. Null here keeps the two view models the same shape.
    paymentSessionId: null,
    startedAt: null,
    renewsAt: null,
    isPaidOwner: entitled && PAID_OWNER_PLAN_SLUGS.includes(slug),
    listingLimit: listingLimitForSlug(entitled ? slug : 'free'),
  };
}

/**
 * Subscribe. A free plan is granted immediately; a priced one goes `pending`, exactly as the server
 * does — see the note at the top of this file.
 */
export async function subscribe(slug) {
  const plan = pricedCatalogue().find((p) => p.slug === slug);
  if (!plan) throw new Error(`[plan] No catalogue plan for "${slug}".`);

  if (plan.price <= 0) {
    setPlan({ id: slug, name: plan.name });
    writePending(null);
    return getSubscription();
  }

  writePending({ slug, paymentRef: `mock-order-${Date.now()}` });
  return getSubscription();
}

/**
 * The local stand-in for the payment webhook — mock only, and there is no http counterpart on
 * purpose. In production the browser cannot activate a subscription; a client that could would be
 * a client that can grant itself a paid plan.
 */
export async function mockActivateSubscription() {
  const pending = readPending();
  if (!pending) return getSubscription();
  const plan = pricedCatalogue().find((p) => p.slug === pending.slug);
  setPlan({ id: pending.slug, name: plan?.name || pending.slug });
  writePending(null);
  return getSubscription();
}
