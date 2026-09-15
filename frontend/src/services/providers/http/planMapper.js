/**
 * Wire ↔ seam translation for billing plans. Plans join on **name**: the wire's identity is a UUID,
 * the app's is a shipped slug, and keying on order would re-point every slug when one is inserted.
 */
const NAME_TO_SLUG = new Map([
  ['Owner Free', 'owner-free'],
  ['Owner Plus', 'owner2'],
  ['Owner Pro', 'owner5'],
  ['Seeker Plus', 'seeker-plus'],
]);

const SLUG_TO_NAME = new Map([...NAME_TO_SLUG].map(([name, slug]) => [slug, name]));

/** Server plan name → the slug the app routes and gates on. `null` when the app has no card for it. */
export const slugForPlanName = (name) => NAME_TO_SLUG.get(String(name || '').trim()) ?? null;

/** The app's slug → the server plan name, for resolving a UUID out of the catalogue. */
export const planNameForSlug = (slug) => SLUG_TO_NAME.get(String(slug || '').trim()) ?? null;

/**
 * Entitlements are numbers off the wire, never parsed from feature prose. A null `listingLimit`
 * grants no allowance of its own and resolves to this free-tier floor, which can only under-grant.
 */
const FREE_TIER_LISTING_LIMIT = 1;

/** The slugs that unlock self-serve promotion. Seeker Plus is a tenant plan and buys no owner tools. */
export const PAID_OWNER_PLAN_SLUGS = ['owner2', 'owner5'];

/**
 * Entitlement is `status === 'active'`, never "the POST returned 200": a priced plan lands `pending`
 * until the signature-verified webhook lands, so an abandoned checkout must not grant it.
 */
export const isEntitled = (status) => status === 'active';

/** Statuses that mean money is owed or in flight, so the checkout is not finished. */
export const isAwaitingPayment = (status) => status === 'pending';

/**
 * @param {object|null} row  `SubscriptionDto`, possibly all-null — which means the free tier
 * @param {object[]} plans   the catalogue, for resolving `planId` back to a name and slug
 */
export function toPlanViewModel(row, plans = []) {
  const byId = new Map((plans || []).map((p) => [p.id, p]));
  const plan = row?.planId ? byId.get(row.planId) : null;
  const slug = plan ? slugForPlanName(plan.name) : null;
  const status = row?.status ?? null;

  // The free tier is the floor, not an error: an unsubscribed caller, an unknown plan and a lapsed
  // subscription all land here, and all three can post one listing.
  const entitled = isEntitled(status) && !!slug;

  return {
    subscriptionId: row?.id ?? null,
    // `id` and `name` keep the shape `getPlan()` has always returned, so the pricing card, the
    // billing panel and the checkout guard did not need rewriting around wire names.
    id: entitled ? slug : 'free',
    name: entitled ? plan.name : 'Free',
    status,
    // The plan the caller is *paying towards* while pending — distinct from the one they hold.
    // Without it the checkout screen cannot say which purchase is waiting on the gateway.
    pendingSlug: isAwaitingPayment(status) ? slug : null,
    paymentRef: row?.paymentRef ?? null,
    // Single-use hosted-checkout session, present only on the `subscribe` response for a priced
    // plan, so a held plan never carries a stale session the checkout could try to reopen.
    paymentSessionId: row?.paymentSessionId ?? null,
    startedAt: row?.startedAt ?? null,
    renewsAt: row?.renewsAt ?? null,
    isPaidOwner: entitled && PAID_OWNER_PLAN_SLUGS.includes(slug),
    // The plan's own ceiling, off the wire. An unsubscribed or unknown-plan caller, and a held
    // plan that states no listing number, all fall to the one-listing floor.
    listingLimit: (entitled ? plan.listingLimit : null) ?? FREE_TIER_LISTING_LIMIT,
  };
}

/** Wire `PlanDto` → the catalogue shape the pricing page reads. */
export const toPlanCatalogueEntry = (row) => ({
  id: row.id,
  slug: slugForPlanName(row.name),
  name: row.name,
  audience: row.audience,
  price: row.price,
  billingCycle: row.billingCycle,
  // Entitlements as numbers, straight off the wire and passed through unchanged: a `null` is the
  // plan stating no number, never unlimited. Only the held-plan view model above floors it.
  listingLimit: row.listingLimit ?? null,
  contactLimit: row.contactLimit ?? null,
  features: row.features || [],
});
