/**
 * Wire ↔ seam translation for the billing plan domain.
 *
 * Three translations live here, and each exists because the server and the UI disagree about
 * something real rather than merely cosmetic.
 *
 * ## 1. Plan identity: a UUID on the wire, a slug in the app
 *
 * The server identifies a plan by UUID (`b1000000-…-0002`). The app has always identified plans by
 * a slug that appears in URLs (`/checkout?plan=owner2`), in a listing-limit table, and in the
 * paid-plan list. Those slugs are in shipped links and bookmarks, so they are not something to
 * renumber; the UUIDs are database identity and not something to hardcode.
 *
 * The join is the plan **name**, which both sides carry and which the seeded catalogue and the
 * checkout page already agree on. Mapping by name rather than by position matters: a fifth plan
 * inserted in the middle would silently re-point every slug if this keyed on order.
 *
 * An unknown name maps to `null` rather than guessing. A plan the app has no slug for is one it has
 * no pricing card, no listing limit and no checkout route for — inventing a slug would put a user
 * on a plan the UI cannot describe.
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
 * ## 2. Entitlements are numbers on the wire, not prose
 *
 * How many live listings a plan allows is a hard number the paywall enforces. The server now carries
 * it as its own field — `PlanDto.listingLimit` (D109) — alongside `contactLimit`, instead of only as
 * prose inside `features` (`"2 live listings"`). So this reads the number off the wire rather than
 * keeping a client-side lookup table that duplicated it and drifted the moment somebody reworded the
 * copy. A `null` limit means no cap: an owner plan has no contact limit, a tenant plan no listing
 * limit.
 *
 * The free-tier floor stays a single constant here, not a table — a signed-in user with no
 * subscription (or a plan the app has no card for) still has to get an answer, and one live listing
 * is the safe floor that can only ever under-grant.
 */
const FREE_TIER_LISTING_LIMIT = 1;

/** The slugs that unlock self-serve promotion. Seeker Plus is a tenant plan and buys no owner tools. */
export const PAID_OWNER_PLAN_SLUGS = ['owner2', 'owner5'];

/**
 * ## 3. `pending` is not `active`, and the difference is the whole slice
 *
 * The mock granted a plan the instant checkout finished, because a localStorage write cannot fail.
 * The server does not: `POST /me/subscription` on a **priced** plan creates the row `pending`
 * against a payment-gateway order and returns the order id in `paymentRef`. Only the
 * signature-verified payment webhook moves it to `active` — nothing the browser does can.
 *
 * So entitlement is `status === 'active'`, never "the POST returned 200". A free plan is active
 * immediately (there is no money to wait for); a paid one is not, and treating the two the same
 * would hand somebody a paid plan for an abandoned checkout.
 */
export const isEntitled = (status) => status === 'active';

/** Statuses that mean money is owed or in flight, so the checkout is not finished. */
export const isAwaitingPayment = (status) => status === 'pending';

/**
 * Wire `SubscriptionDto` → the seam's plan view model.
 *
 * `getSubscription` answers 200 with an **empty document** rather than 404 for someone who never
 * subscribed, so `row` is always an object and every field on it may be null. That is deliberate
 * server-side ("the plan screen renders 'you are on the free tier' from an empty object far more
 * naturally than from an error it has to catch") and this mirrors it: no subscription resolves to
 * the free tier rather than to an error state.
 *
 * @param {object|null} row  `SubscriptionDto`, possibly all-null
 * @param {object[]} plans   the catalogue, used to resolve `planId` back to a name and slug
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
    // Single-use Cashfree hosted-checkout session (Option A). Present only on the `subscribe`
    // response for a priced plan; `getSubscription` always answers null, so a held plan never
    // carries a stale session the checkout could try to reopen.
    paymentSessionId: row?.paymentSessionId ?? null,
    startedAt: row?.startedAt ?? null,
    renewsAt: row?.renewsAt ?? null,
    isPaidOwner: entitled && PAID_OWNER_PLAN_SLUGS.includes(slug),
    // The plan's own ceiling, off the wire (D109). An unsubscribed or unknown-plan caller, and a
    // held plan with no listing cap (a tenant plan), all fall to the one-listing floor.
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
  // Entitlements as numbers, straight off the wire (D109). `null` means no cap for that dimension.
  listingLimit: row.listingLimit ?? null,
  contactLimit: row.contactLimit ?? null,
  features: row.features || [],
});
